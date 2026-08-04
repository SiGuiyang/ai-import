/**
 * POST /api/import-tasks/dispatch
 *
 * Outbox Dispatcher：轮询 event_outbox，将 PENDING 事件分发到 Worker 执行。
 * 完整实现 Outbox 模式的事件生命周期管理。
 *
 * 触发方式：
 * 1. 上传完成后 fire-and-forget 调用（加速首批处理）
 * 2. 手动触发（兜底/重试）
 * 3. Vercel Cron（Pro 计划）
 *
 * 可靠性保证：
 * - 任务创建与 Outbox 写入在同一事务（上传 API 保证）
 * - SENT 超时回收：卡在 SENT > 60s 的事件自动重置为 PENDING
 * - 幂等处理：Worker 检查 batch 状态 + Redis 重试上限
 * - 失败重试：最多 3 次，超限标记 FAILED
 *
 * 每次调用处理最多 MAX_EVENTS_PER_RUN 个事件
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql, OUTBOX_SENT_TIMEOUT_SEC } from '@/lib/db';
import { logTraceEvent } from '@/lib/trace';
import { processBatchJob } from '@/lib/import-worker';
import { registerActiveTask } from '@/lib/redis';

const MAX_EVENTS_PER_RUN = 5;
const MAX_OUTBOX_RETRIES = 3;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;
  let recovered = 0;

  try {
    await initDB();
    const sql = await getSql();

    // ============================================================
    // 0. 崩溃恢复：回收卡在 SENT 状态超过 60 秒的事件
    //
    // 场景：Dispatcher 标记 SENT 后进程崩溃，Worker 未执行/未完成。
    // 检查条件：
    //   (a) outbox.status = 'SENT'
    //   (b) outbox.sent_at < NOW() - 60s
    //   (c) 对应 batch 未 SUCCEEDED/FAILED（即未真正完成）
    // 满足条件则重置为 PENDING 重新投递。
    // ============================================================
    try {
      const stuckResult = await sql`
        UPDATE event_outbox
        SET status = 'PENDING', next_retry_at = NOW()
        WHERE id IN (
          SELECT eo.id FROM event_outbox eo
          LEFT JOIN import_task_batches itb
            ON itb.task_id = eo.aggregate_id
            AND itb.unit_id = (eo.payload->>'unitId')
          WHERE eo.status = 'SENT'
            AND eo.sent_at < NOW() - INTERVAL '${OUTBOX_SENT_TIMEOUT_SEC} seconds'
            AND (itb.status IS NULL OR itb.status NOT IN ('SUCCEEDED', 'FAILED'))
        )
        RETURNING id
      `;
      recovered = stuckResult.length;
      if (recovered > 0) {
        console.log(`[Dispatcher] recovered ${recovered} stuck SENT event(s)`);
      }
    } catch (e) {
      console.warn('[Dispatcher] SENT recovery check failed:', String(e).slice(0, 100));
    }

    // ============================================================
    // 1. 查询待处理（PENDING + 到达重试时间）的事件
    // ============================================================
    let events: any[] = [];
    try {
      events = await sql`
        SELECT * FROM event_outbox
        WHERE status = 'PENDING' AND next_retry_at <= NOW()
        ORDER BY created_at ASC
        LIMIT ${MAX_EVENTS_PER_RUN}
      `;
    } catch {
      return NextResponse.json({
        code: 0,
        message: 'no events or db error',
        processed: 0,
        failed: 0,
        recovered,
      });
    }

    if (events.length === 0) {
      return NextResponse.json({
        code: 0,
        message: 'no pending events',
        processed: 0,
        failed: 0,
        recovered,
      });
    }

    // ============================================================
    // 2. 逐条分发处理
    // ============================================================
    for (const event of events) {
      try {
        // 2a. 标记为 SENT（投递中）
        const sentResult = await sql`
          UPDATE event_outbox
          SET status = 'SENT', sent_at = NOW()
          WHERE id = ${event.id} AND status = 'PENDING'
          RETURNING id
        `;

        // 乐观锁冲突：其他 Dispatcher 实例已抢占此事件
        if (sentResult.length === 0) {
          console.log(`[Dispatcher] event ${event.id} already sent by another instance, skip`);
          continue;
        }

        // 解析 payload
        const payload = typeof event.payload === 'string'
          ? JSON.parse(event.payload)
          : event.payload;

        // 2b. 标记处理单元为 QUEUED
        await sql`
          UPDATE import_task_batches
          SET status = 'QUEUED'
          WHERE task_id = ${payload.taskId}
            AND unit_id = ${payload.unitId}
            AND status = 'PENDING'
        `;

        // Redis: 注册活跃任务
        registerActiveTask(payload.taskId).catch(() => {});

        // 2c. 执行 Worker
        const result = await processBatchJob({
          taskId: payload.taskId,
          unitId: payload.unitId,
          batchIndex: payload.batchIndex,
          startRow: payload.startRow,
          endRow: payload.endRow,
          fileName: payload.fileName,
          fileUrl: payload.fileUrl,
          rule: payload.rule,
          traceId: payload.traceId,
        });

        // 2d. Worker 成功 → Outbox 标记 SUCCEEDED
        await sql`
          UPDATE event_outbox
          SET status = 'SUCCEEDED'
          WHERE id = ${event.id}
        `;

        processed++;
        console.log(
          `[Dispatcher] batch ${payload.batchIndex}: success=${result.success} failed=${result.failed} ` +
          `parse=${result.timings.parseDurationMs}ms insert=${result.timings.insertDurationMs}ms`
        );

      } catch (workerError) {
        failed++;

        // ============================================================
        // 2e. Worker 失败 → Outbox 重试逻辑
        //
        // 当前 retry_count 来自 Outbox 表（已在 DB 层累加过）。
        // Worker 异常说明本批次执行失败，需要判定是否还允许重试。
        // ============================================================
        try {
          const currentRetry = (event.retry_count || 0) + 1; // 本次失败后的计数

          if (currentRetry >= MAX_OUTBOX_RETRIES) {
            // 超出最大重试次数 → 永久失败
            await sql`
              UPDATE event_outbox
              SET status = 'FAILED',
                  retry_count = ${currentRetry},
                  next_retry_at = NOW() + INTERVAL '5 minutes'
              WHERE id = ${event.id}
            `;

            console.error(
              `[Dispatcher] event ${event.id} PERMANENTLY FAILED: ` +
              `retries=${currentRetry}/${MAX_OUTBOX_RETRIES} ` +
              `error=${String(workerError).slice(0, 100)}`
            );

          } else {
            // 还有重试次数 → 退回 PENDING 并延后重试
            const delaySeconds = 30 * currentRetry; // 递增退避：30s, 60s, 90s
            await sql`
              UPDATE event_outbox
              SET status = 'PENDING',
                  retry_count = ${currentRetry},
                  next_retry_at = NOW() + INTERVAL '${delaySeconds} seconds'
              WHERE id = ${event.id}
            `;

            console.warn(
              `[Dispatcher] event ${event.id} will retry: ` +
              `attempt=${currentRetry}/${MAX_OUTBOX_RETRIES} ` +
              `delay=${delaySeconds}s error=${String(workerError).slice(0, 100)}`
            );
          }
        } catch (outboxError) {
          console.error(`[Dispatcher] failed to update outbox for ${event.id}:`, String(outboxError).slice(0, 100));
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Dispatcher] processed=${processed} failed=${failed} recovered=${recovered} elapsed=${elapsed}ms`);

    return NextResponse.json({
      code: 0,
      message: 'dispatch completed',
      processed,
      failed,
      recovered,
      elapsedMs: elapsed,
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: `Dispatcher error: ${String(e)}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/import-tasks/dispatch
 * 查询 Outbox 队列状态
 */
export async function GET(req: NextRequest) {
  try {
    await initDB();
    const sql = await getSql();

    let pending = 0;
    let sent = 0;
    let failed = 0;
    let succeeded = 0;
    let stuck = 0;

    try {
      const pendingResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'PENDING'`;
      pending = parseInt(pendingResult[0]?.cnt || '0');

      const sentResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'SENT'`;
      sent = parseInt(sentResult[0]?.cnt || '0');

      const failedResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'FAILED'`;
      failed = parseInt(failedResult[0]?.cnt || '0');

      const succeededResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'SUCCEEDED'`;
      succeeded = parseInt(succeededResult[0]?.cnt || '0');

      // 卡住的 SENT 事件（超过 60s 未完成）
      const stuckResult = await sql`
        SELECT COUNT(*) as cnt FROM event_outbox
        WHERE status = 'SENT' AND sent_at < NOW() - INTERVAL '${OUTBOX_SENT_TIMEOUT_SEC} seconds'
      `;
      stuck = parseInt(stuckResult[0]?.cnt || '0');
    } catch { /* ignore */ }

    return NextResponse.json({
      code: 0,
      data: {
        pending,
        sent,
        failed,
        succeeded,
        stuck,
        total: pending + sent + failed + succeeded,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

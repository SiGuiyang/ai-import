/**
 * POST /api/import-tasks/dispatch
 *
 * Outbox Dispatcher：轮询 event_outbox，将 PENDING 事件分发到 Worker 执行
 *
 * 触发方式：
 * 1. Vercel Cron Job 定时调用
 * 2. 上传完成后立即调用（加速首批处理）
 * 3. 手动触发
 *
 * 每次调用处理最多 MAX_EVENTS_PER_RUN 个批次
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { logTraceEvent } from '@/lib/trace';
import { processBatchJob } from '@/lib/import-worker';

const MAX_EVENTS_PER_RUN = 5;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;

  try {
    await initDB();
    const sql = await getSql();

    // 1. 查询待处理的 Outbox 事件
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
      });
    }

    if (events.length === 0) {
      return NextResponse.json({
        code: 0,
        message: 'no pending events',
        processed: 0,
        failed: 0,
      });
    }

    // 2. 逐条分发处理
    for (const event of events) {
      try {
        // 标记为 SENT
        await sql`
          UPDATE event_outbox
          SET status = 'SENT', sent_at = NOW()
          WHERE id = ${event.id} AND status = 'PENDING'
        `;

        // 解析 payload
        const payload = typeof event.payload === 'string'
          ? JSON.parse(event.payload)
          : event.payload;

        // 标记处理单元为 QUEUED
        await sql`
          UPDATE import_task_batches
          SET status = 'QUEUED'
          WHERE task_id = ${payload.taskId}
            AND unit_id = ${payload.unitId}
            AND status = 'PENDING'
        `;

        // 执行 Worker
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

        processed++;
        console.log(
          `[Dispatcher] batch ${payload.batchIndex}: success=${result.success} failed=${result.failed} ` +
          `parse=${result.timings.parseDurationMs}ms rule=${result.timings.ruleDurationMs}ms ` +
          `validate=${result.timings.validateDurationMs}ms insert=${result.timings.insertDurationMs}ms`
        );
      } catch (e) {
        failed++;

        // 标记 Outbox 事件失败并重试
        try {
          await sql`
            UPDATE event_outbox
            SET status = 'PENDING',
                retry_count = retry_count + 1,
                next_retry_at = NOW() + INTERVAL '30 seconds'
            WHERE id = ${event.id}
          `;
        } catch { /* ignore */ }

        console.error(`[Dispatcher] event ${event.id} failed:`, String(e).slice(0, 200));
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Dispatcher] processed=${processed} failed=${failed} elapsed=${elapsed}ms`);

    return NextResponse.json({
      code: 0,
      message: 'dispatch completed',
      processed,
      failed,
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
 * 查询 Outbox 状态
 */
export async function GET(req: NextRequest) {
  try {
    await initDB();
    const sql = await getSql();

    let pending = 0;
    let sent = 0;
    let failed = 0;

    try {
      const pendingResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'PENDING'`;
      pending = parseInt(pendingResult[0]?.cnt || '0');

      const sentResult = await sql`SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'SENT'`;
      sent = parseInt(sentResult[0]?.cnt || '0');

      const failedResult = await sql`
        SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'FAILED'
      `;
      failed = parseInt(failedResult[0]?.cnt || '0');
    } catch { /* ignore */ }

    return NextResponse.json({
      code: 0,
      data: {
        pending,
        sent,
        failed,
        total: pending + sent + failed,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

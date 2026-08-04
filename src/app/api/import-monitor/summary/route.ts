/**
 * GET /api/import-monitor/summary
 *
 * 模块八：监控聚合接口
 * 返回实时吞吐量、队列积压（行数）、阶段耗时分布、错误类型分布、
 * 慢批次 TOP 10、失败任务趋势、DB 连接状态、Worker 并发数
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { ERROR_CODES } from '@/lib/types';
import { getThroughputHistory, getActiveTaskIds, getRedis } from '@/lib/redis';

export async function GET(req: NextRequest) {
  const sql = await getSql();

  // ============ 数据库连接检查 ============
  let dbConnected = false;
  try {
    const result = await sql`SELECT 1 as ping`;
    dbConnected = (result[0]?.ping || result.rows?.[0]?.ping) === 1;
  } catch {
    dbConnected = false;
  }

  // ============ 1. 实时吞吐量：优先 Redis，降级 DB ============
  let throughput: { minute: string; rows: number }[] = [];
  try {
    const redisThroughput = await getThroughputHistory(5);
    if (redisThroughput.length > 0 && redisThroughput.some((t) => t.rows > 0)) {
      throughput = redisThroughput.reverse();
    } else if (dbConnected) {
      const now = new Date();
      for (let i = 4; i >= 0; i--) {
        const bucket = new Date(now.getTime() - i * 60000);
        const minuteKey = bucket.toISOString().slice(0, 16);
        const result = await sql`
          SELECT COALESCE(SUM(
            (bpl.insert_duration_ms > 0)::int
          ), 0) as processed_batches
          FROM batch_performance_log bpl
          WHERE bpl.created_at >= ${minuteKey + ':00'}::timestamp
            AND bpl.created_at < (${minuteKey + ':00'}::timestamp + INTERVAL '1 minute')
        `;
        throughput.push({
          minute: minuteKey,
          rows: parseInt(result[0]?.processed_batches || '0'),
        });
      }
    }
  } catch { /* ignore */ }

  // ============ 2. 队列积压深度（行数） ============
  let queueDepth = 0;
  let queueDepthRows = 0;
  let queueUnavailable = !dbConnected;
  try {
    // 事件数量
    const eventResult = await sql`
      SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'PENDING'
    `;
    queueDepth = parseInt(eventResult[0]?.cnt || '0');

    // 待处理行数：从 PENDING 批次的 end_row - start_row + 1 累加
    const rowsResult = await sql`
      SELECT COALESCE(SUM(end_row - start_row + 1), 0) as total_pending_rows
      FROM import_task_batches
      WHERE status IN ('PENDING', 'QUEUED')
    `;
    queueDepthRows = parseInt(rowsResult[0]?.total_pending_rows || '0');
  } catch {
    queueUnavailable = true;
  }

  // ============ 3. 阶段耗时分布（P50/P95/P99） ============
  const stageDistribution: { stage: string; p50: number; p95: number; p99: number }[] = [];
  if (dbConnected) {
    try {
      const stages: { key: string; name: string }[] = [
        { key: 'parse_duration_ms', name: '文件解析' },
        { key: 'rule_duration_ms', name: '规则引擎' },
        { key: 'validate_duration_ms', name: '数据校验' },
        { key: 'insert_duration_ms', name: '批量写入' },
        { key: 'total_duration_ms', name: '总计' },
      ];

      for (const stage of stages) {
        const result = await sql`
          SELECT
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${sql(stage.key)}) as p50,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${sql(stage.key)}) as p95,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${sql(stage.key)}) as p99
          FROM batch_performance_log
          WHERE created_at >= NOW() - INTERVAL '1 hour'
        `;
        const r = result[0] || {};
        stageDistribution.push({
          stage: stage.name,
          p50: Math.round(r.p50 || 0),
          p95: Math.round(r.p95 || 0),
          p99: Math.round(r.p99 || 0),
        });
      }
    } catch { /* ignore */ }
  }

  // ============ 4. 错误类型分布 ============
  let errorDistribution: { errorCode: string; errorName: string; count: number }[] = [];
  if (dbConnected) {
    try {
      const result = await sql`
        SELECT error_code, COUNT(*) as cnt
        FROM import_task_errors
        WHERE created_at >= NOW() - INTERVAL '1 hour'
        GROUP BY error_code ORDER BY cnt DESC
      `;
      errorDistribution = result.map((r: any) => ({
        errorCode: r.error_code,
        errorName: ERROR_CODES[r.error_code] || r.error_code,
        count: parseInt(r.cnt),
      }));
    } catch { /* ignore */ }
  }

  // ============ 5. 慢批次 TOP 10 ============
  let slowBatches: any[] = [];
  if (dbConnected) {
    try {
      slowBatches = await sql`
        SELECT task_id, unit_id, batch_index, total_duration_ms,
               parse_duration_ms, rule_duration_ms, validate_duration_ms,
               insert_duration_ms, status
        FROM batch_performance_log
        ORDER BY total_duration_ms DESC LIMIT 10
      `;
    } catch { /* ignore */ }
  }

  // ============ 6. 最近任务 ============
  let recentTasks: any[] = [];
  if (dbConnected) {
    try {
      recentTasks = await sql`
        SELECT id, file_name, status, total_rows, processed_rows,
               success_rows, failed_rows, created_at, trace_id, degraded
        FROM import_tasks
        ORDER BY created_at DESC LIMIT 10
      `;
    } catch { /* ignore */ }
  }

  // ============ 7. 失败任务趋势（最近 24h，按小时） ============
  let failedTaskTrends: { hour: string; failedCount: number; errorCount: number }[] = [];
  if (dbConnected) {
    try {
      const result = await sql`
        SELECT
          DATE_TRUNC('hour', created_at) as hour_bucket,
          COUNT(*) FILTER (WHERE status IN ('FAILED', 'PARTIAL_SUCCESS')) as failed_count,
          COALESCE(SUM(failed_rows), 0) as error_count
        FROM import_tasks
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY hour_bucket
        ORDER BY hour_bucket
      `;
      failedTaskTrends = (Array.isArray(result) ? result : []).map((r: any) => ({
        hour: String(r.hour_bucket),
        failedCount: parseInt(r.failed_count || '0'),
        errorCount: parseInt(r.error_count || '0'),
      }));
    } catch { /* ignore */ }
  }

  // ============ Worker 并发信息 ============
  let activeWorkerCount = 0;
  try {
    const redis = getRedis();
    if (redis) {
      // 从活跃任务数推断并发 Worker 数（每个活跃任务至少 1 个 Worker）
      activeWorkerCount = (await getActiveTaskIds().catch(() => [])).length;
      // 从最大并发 Worker 数配置获取上限
      const maxWorkers = parseInt(process.env.MAX_CONCURRENT_BATCHES || '5');
      if (activeWorkerCount > maxWorkers) activeWorkerCount = maxWorkers;
    }
  } catch { /* ignore */ }

  // ============ 组装响应 ============
  return NextResponse.json({
    code: 0,
    data: {
      dbConnected,
      throughput,
      queueDepth,
      queueDepthRows,
      queueUnavailable,
      activeTasks: activeWorkerCount,
      activeWorkerCount,
      maxWorkers: parseInt(process.env.MAX_CONCURRENT_BATCHES || '5'),
      stageDistribution,
      errorDistribution,
      slowBatches: slowBatches.map((b: any) => ({
        taskId: b.task_id,
        unitId: b.unit_id,
        batchIndex: b.batch_index,
        status: b.status,
        parseMs: b.parse_duration_ms,
        ruleMs: b.rule_duration_ms,
        validateMs: b.validate_duration_ms,
        insertMs: b.insert_duration_ms,
        totalMs: b.total_duration_ms,
      })),
      recentTasks: recentTasks.map((t: any) => ({
        taskId: t.id,
        fileName: t.file_name,
        status: t.status,
        totalRows: t.total_rows,
        processedRows: t.processed_rows,
        successRows: t.success_rows,
        failedRows: t.failed_rows,
        createdAt: t.created_at,
        traceId: t.trace_id,
        degraded: t.degraded,
      })),
      failedTaskTrends,
    },
  });
}

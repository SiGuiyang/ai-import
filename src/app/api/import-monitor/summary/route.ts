/**
 * GET /api/import-monitor/summary
 *
 * 监控聚合接口：返回实时吞吐量、队列积压、阶段耗时分布、错误类型分布
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { ERROR_CODES } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    await initDB();
    const sql = await getSql();

    // 1. 实时吞吐量（过去 5 分钟，每分钟成功入库行数）
    let throughput: { minute: string; rows: number }[] = [];
    try {
      const result = await sql`
        SELECT
          DATE_TRUNC('minute', created_at) as minute_bucket,
          SUM(insert_duration_ms) as total_ms
        FROM batch_performance_log
        WHERE created_at >= NOW() - INTERVAL '5 minutes'
        GROUP BY minute_bucket
        ORDER BY minute_bucket
      `;
      throughput = (Array.isArray(result) ? result : []).map((r: any) => ({
        minute: String(r.minute_bucket),
        rows: 0,
      }));
      // 补充每分钟的实际处理行数
      for (const t of throughput) {
        const rowsResult = await sql`
          SELECT COALESCE(SUM(success_rows + failed_rows), 0) as cnt
          FROM import_tasks
          WHERE completed_at >= ${t.minute}::timestamp
            AND completed_at < (${t.minute}::timestamp + INTERVAL '1 minute')
        `;
        t.rows = parseInt(rowsResult[0]?.cnt || '0');
      }
    } catch { /* ignore */ }

    // 2. 队列积压
    let queueDepth = 0;
    try {
      const result = await sql`
        SELECT COUNT(*) as cnt FROM event_outbox WHERE status = 'PENDING'
      `;
      queueDepth = parseInt(result[0]?.cnt || '0');
    } catch { /* ignore */ }

    // 3. 阶段耗时分布（P50, P95, P99）
    const stageDistribution: { stage: string; p50: number; p95: number; p99: number }[] = [];
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

    // 4. 错误类型分布
    let errorDistribution: { errorCode: string; errorName: string; count: number }[] = [];
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

    // 5. 慢批次 TOP 10
    let slowBatches: any[] = [];
    try {
      slowBatches = await sql`
        SELECT task_id, unit_id, batch_index, total_duration_ms,
               parse_duration_ms, rule_duration_ms, validate_duration_ms, insert_duration_ms, status
        FROM batch_performance_log
        ORDER BY total_duration_ms DESC LIMIT 10
      `;
    } catch { /* ignore */ }

    // 6. 最近任务
    let recentTasks: any[] = [];
    try {
      recentTasks = await sql`
        SELECT id, file_name, status, total_rows, processed_rows, success_rows, failed_rows, created_at, trace_id
        FROM import_tasks
        ORDER BY created_at DESC LIMIT 10
      `;
    } catch { /* ignore */ }

    return NextResponse.json({
      code: 0,
      data: {
        throughput,
        queueDepth,
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
        })),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

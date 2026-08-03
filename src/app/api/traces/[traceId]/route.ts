/**
 * GET /api/traces/[traceId]
 *
 * 全链路 Trace 时间线查询
 * 可按 trace_id、task_id、文件名、批次号、行号范围、错误码搜索
 *
 * 查询参数：
 *   taskId    - 任务ID
 *   fileName  - 文件名
 *   batch     - 批次号
 *   errorCode - 错误码
 *   rowFrom   - 行号范围开始
 *   rowTo     - 行号范围结束
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { ERROR_CODES } from '@/lib/types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
  try {
    const { traceId } = await params;
    const url = new URL(req.url);

    if (!traceId) {
      return NextResponse.json(
        { code: 400, message: '缺少 traceId 参数' },
        { status: 400 }
      );
    }

    await initDB();
    const sql = await getSql();

    // 1. 查询时间线事件
    let events: any[] = [];
    try {
      events = await sql`
        SELECT * FROM trace_events
        WHERE trace_id = ${traceId}
        ORDER BY occurred_at ASC
      `;
    } catch {
      events = [];
    }

    const timeline = events.map((e: any) => ({
      id: e.id,
      traceId: e.trace_id,
      taskId: e.task_id,
      unitId: e.unit_id,
      eventName: e.event_name,
      eventStatus: e.event_status,
      message: e.message,
      occurredAt: e.occurred_at,
    }));

    // 2. 关联的任务信息
    let task: any = null;
    try {
      const taskRows = await sql`
        SELECT * FROM import_tasks WHERE trace_id = ${traceId}
      `;
      if (taskRows.length > 0) {
        const t = taskRows[0];
        task = {
          taskId: t.id,
          fileName: t.file_name,
          status: t.status,
          totalRows: t.total_rows,
          processedRows: t.processed_rows,
          successRows: t.success_rows,
          failedRows: t.failed_rows,
          totalBatches: t.total_batches,
          degraded: t.degraded,
          traceId: t.trace_id,
          createdAt: t.created_at,
          completedAt: t.completed_at,
        };
      }
    } catch { /* ignore */ }

    // 3. 关联的错误明细（支持筛选）
    let errors: any[] = [];
    try {
      const conditions = [`trace_id = ${sql`${traceId}`}`];
      const batchParam = url.searchParams.get('batch');
      const errorCodeParam = url.searchParams.get('errorCode');
      const rowFrom = url.searchParams.get('rowFrom');
      const rowTo = url.searchParams.get('rowTo');

      if (batchParam) {
        conditions.push(`batch_index = ${parseInt(batchParam)}`);
      }
      if (errorCodeParam) {
        conditions.push(`error_code = ${sql`${errorCodeParam}`}`);
      }
      if (rowFrom) {
        conditions.push(`row_number >= ${parseInt(rowFrom)}`);
      }
      if (rowTo) {
        conditions.push(`row_number <= ${parseInt(rowTo)}`);
      }

      const whereStr = conditions.join(' AND ');
      const rawResult = await sql.raw(
        `SELECT * FROM import_task_errors WHERE ${whereStr} ORDER BY batch_index, row_number LIMIT 200`
      );
      const rows = rawResult.rows || rawResult;

      errors = (Array.isArray(rows) ? rows : []).map((e: any) => ({
        id: e.id,
        taskId: e.task_id,
        unitId: e.unit_id,
        batchIndex: e.batch_index,
        rowNumber: e.row_number,
        fieldName: e.field_name,
        rawValue: e.raw_value,
        errorCode: e.error_code,
        errorName: ERROR_CODES[e.error_code] || e.error_code,
        errorReason: e.error_reason,
        createdAt: e.created_at,
      }));
    } catch { /* ignore */ }

    // 4. 批次性能日志
    let batches: any[] = [];
    try {
      const batchRows = await sql`
        SELECT * FROM batch_performance_log
        WHERE trace_id = ${traceId}
        ORDER BY batch_index
      `;
      batches = batchRows.map((b: any) => ({
        unitId: b.unit_id,
        batchIndex: b.batch_index,
        status: b.status,
        parseMs: b.parse_duration_ms,
        ruleMs: b.rule_duration_ms,
        validateMs: b.validate_duration_ms,
        insertMs: b.insert_duration_ms,
        totalMs: b.total_duration_ms,
      }));
    } catch { /* ignore */ }

    return NextResponse.json({
      code: 0,
      data: {
        traceId,
        timeline,
        task,
        errors,
        batches,
        summary: {
          totalEvents: timeline.length,
          totalErrors: errors.length,
          totalBatches: batches.length,
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

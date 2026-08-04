/**
 * GET /api/traces/[traceId]
 *
 * 全链路 Trace 时间线查询
 * 支持按 traceId、batch、errorCode、rowFrom、rowTo 筛选
 *
 * 查询参数：
 *   batch     - 批次号筛选
 *   errorCode - 错误码筛选
 *   rowFrom   - 行号范围开始
 *   rowTo     - 行号范围结束
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { ERROR_CODES, SUGGESTED_FIXES } from '@/lib/types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> }
) {
  const { traceId } = await params;

  if (!traceId) {
    return NextResponse.json({ code: 400, message: '缺少 traceId 参数' }, { status: 400 });
  }

  const url = new URL(req.url);
  const sql = await getSql();

  // ============ 1. 时间线事件 ============
  let timeline: any[] = [];
  try {
    const events = await sql`
      SELECT id, trace_id, task_id, unit_id, event_name, event_status, message, occurred_at
      FROM trace_events
      WHERE trace_id = ${traceId}
      ORDER BY occurred_at ASC
    `;
    timeline = (Array.isArray(events) ? events : []).map((e: any) => ({
      id: e.id,
      traceId: e.trace_id,
      taskId: e.task_id,
      unitId: e.unit_id,
      eventName: e.event_name,
      eventStatus: e.event_status,
      message: e.message,
      occurredAt: e.occurred_at instanceof Date ? e.occurred_at.toISOString() : String(e.occurred_at),
    }));
  } catch {}

  // ============ 2. 关联任务 + 解析规则 ============
  let task: any = null;
  try {
    const taskRows = await sql`
      SELECT t.*, r.name as rule_name
      FROM import_tasks t
      LEFT JOIN parse_rules r ON r.id = t.rule_id
      WHERE t.trace_id = ${traceId}
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
        completedBatches: t.completed_batches,
        degraded: t.degraded,
        ruleName: t.rule_name || null,
        traceId: t.trace_id,
        createdAt: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
        completedAt: t.completed_at
          ? (t.completed_at instanceof Date ? t.completed_at.toISOString() : String(t.completed_at))
          : null,
      };
    }
  } catch {}

  // ============ 3. 错误明细（支持按批次/错误码/行号筛选） ============
  let errors: any[] = [];
  try {
    const batchParam = url.searchParams.get('batch');
    const errorCodeParam = url.searchParams.get('errorCode');
    const rowFrom = url.searchParams.get('rowFrom');
    const rowTo = url.searchParams.get('rowTo');

    const conditions = [sql`e.trace_id = ${traceId}`];
    if (batchParam) conditions.push(sql`e.batch_index = ${parseInt(batchParam)}`);
    if (errorCodeParam) conditions.push(sql`e.error_code = ${errorCodeParam}`);
    if (rowFrom) conditions.push(sql`e.row_number >= ${parseInt(rowFrom)}`);
    if (rowTo) conditions.push(sql`e.row_number <= ${parseInt(rowTo)}`);

    const whereClause = conditions.reduce((prev, curr) => sql`${prev} AND ${curr}`);

    const rawResult = await sql`
      SELECT e.*, b.retry_count, b.status as batch_status
      FROM import_task_errors e
      LEFT JOIN import_task_batches b ON b.task_id = e.task_id AND b.unit_id = e.unit_id
      WHERE ${whereClause}
      ORDER BY e.batch_index, e.row_number
      LIMIT 200
    `;

    errors = (Array.isArray(rawResult) ? rawResult : []).map((e: any) => ({
      id: e.id,
      taskId: e.task_id,
      unitId: e.unit_id,
      batchIndex: e.batch_index,
      rowNumber: e.row_number,
      fieldName: e.field_name,
      rawValue: e.raw_value,
      rawValueMasked: e.raw_value_masked || e.raw_value,
      errorCode: e.error_code,
      errorName: ERROR_CODES[e.error_code] || e.error_code,
      errorReason: e.error_reason,
      suggestedFix: e.suggested_fix || SUGGESTED_FIXES[e.error_code] || '',
      retried: (e.retry_count || 0) > 0,
      retryCount: e.retry_count || 0,
      batchStatus: e.batch_status,
      createdAt: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
    }));
  } catch {}

  // ============ 4. 批次性能日志 ============
  let batches: any[] = [];
  try {
    const batchRows = await sql`
      SELECT bpl.unit_id, bpl.batch_index, bpl.status,
             bpl.parse_duration_ms, bpl.rule_duration_ms,
             bpl.validate_duration_ms, bpl.insert_duration_ms,
             bpl.total_duration_ms, b.retry_count, b.start_row, b.end_row
      FROM batch_performance_log bpl
      LEFT JOIN import_task_batches b ON b.unit_id = bpl.unit_id AND b.task_id = bpl.task_id
      WHERE bpl.trace_id = ${traceId}
      ORDER BY bpl.batch_index
    `;
    batches = (Array.isArray(batchRows) ? batchRows : []).map((b: any) => ({
      unitId: b.unit_id,
      batchIndex: b.batch_index,
      status: b.status,
      startRow: b.start_row,
      endRow: b.end_row,
      retryCount: b.retry_count || 0,
      parseMs: b.parse_duration_ms,
      ruleMs: b.rule_duration_ms,
      validateMs: b.validate_duration_ms,
      insertMs: b.insert_duration_ms,
      totalMs: b.total_duration_ms,
    }));
  } catch {}

  // ============ 5. 批次级错误分组（用于按批次展开错误） ============
  let errorsByBatch: Record<number, any[]> = {};
  for (const err of errors) {
    const bi = err.batchIndex;
    if (!errorsByBatch[bi]) errorsByBatch[bi] = [];
    errorsByBatch[bi].push(err);
  }

  // ============ 响应 ============
  return NextResponse.json({
    code: 0,
    data: {
      traceId,
      timeline,
      task,
      errors,
      errorsByBatch,
      batches,
      summary: {
        totalEvents: timeline.length,
        totalErrors: errors.length,
        totalBatches: batches.length,
      },
    },
  });
}

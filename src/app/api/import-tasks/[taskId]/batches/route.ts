/**
 * 模块七：批次列表 API
 *
 * GET  /api/import-tasks/[taskId]/batches
 * 返回任务的所有批次列表，含性能数据和错误计数。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export interface BatchItem {
  id: string;
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
  status: string;
  errorCount: number;
  retryCount: number;
  version: number;
  createdAt: string;
  completedAt?: string;
  performance?: {
    parseMs: number;
    ruleMs: number;
    validateMs: number;
    insertMs: number;
    totalMs: number;
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const { taskId } = await params;
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;

  try {
    const sql = await getSql();

    // 查询批次主表
    let batchQuery = sql`
      SELECT b.id, b.unit_id, b.batch_index, b.start_row, b.end_row,
             b.status, b.error_count, b.retry_count, b.version,
             b.created_at, b.completed_at
      FROM import_task_batches b
      WHERE b.task_id = ${taskId}
    `;

    if (status) {
      batchQuery = sql`${batchQuery} AND b.status = ${status}`;
    }

    batchQuery = sql`${batchQuery} ORDER BY b.batch_index ASC`;

    const batches = await batchQuery;

    if (batches.length === 0) {
      return NextResponse.json([]);
    }

    // 查询性能日志
    const performanceLogs = await sql`
      SELECT unit_id, parse_duration_ms, rule_duration_ms,
             validate_duration_ms, insert_duration_ms, total_duration_ms
      FROM batch_performance_log
      WHERE task_id = ${taskId}
        AND unit_id = ANY(${batches.map((b: any) => b.unit_id)}::text[])
    `;

    const perfMap = new Map<string, any>();
    for (const p of performanceLogs) {
      perfMap.set(p.unit_id, p);
    }

    const result: BatchItem[] = batches.map((b: any) => {
      const perf = perfMap.get(b.unit_id);
      return {
        id: b.id,
        unitId: b.unit_id,
        batchIndex: b.batch_index,
        startRow: b.start_row,
        endRow: b.end_row,
        status: b.status,
        errorCount: b.error_count ?? 0,
        retryCount: b.retry_count ?? 0,
        version: b.version ?? 0,
        createdAt: b.created_at instanceof Date ? b.created_at.toISOString() : String(b.created_at),
        completedAt: b.completed_at
          ? (b.completed_at instanceof Date ? b.completed_at.toISOString() : String(b.completed_at))
          : undefined,
        performance: perf
          ? {
              parseMs: perf.parse_duration_ms ?? 0,
              ruleMs: perf.rule_duration_ms ?? 0,
              validateMs: perf.validate_duration_ms ?? 0,
              insertMs: perf.insert_duration_ms ?? 0,
              totalMs: perf.total_duration_ms ?? 0,
            }
          : undefined,
      };
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error('[BatchList] 查询批次列表失败:', e);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

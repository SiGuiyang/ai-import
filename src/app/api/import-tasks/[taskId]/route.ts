/**
 * 模块七：任务详情 API
 *
 * GET  /api/import-tasks/[taskId]
 * 返回任务进度、吞吐量、预计剩余时间等完整信息。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getTaskThroughput, getDegradedSkuRowCount } from '@/lib/redis';
import type { TaskProgressResponse } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const { taskId } = await params;

  try {
    const sql = await getSql();

    const rows = await sql`
      SELECT id, file_name, status, trace_id,
             total_rows, processed_rows, success_rows, failed_rows,
             total_batches, completed_batches,
             degraded, degraded_reason, degraded_sku_rows,
             created_at, completed_at
      FROM import_tasks
      WHERE id = ${taskId}
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const t = rows[0];

    // 计算吞吐量（行/秒），基于最近 3 分钟
    const throughput = await getTaskThroughput(taskId, 3);

    // 计算预计剩余时间
    const remainingRows = t.total_rows - t.processed_rows;
    let estimatedRemainingSec = 0;
    if (throughput > 0 && remainingRows > 0) {
      estimatedRemainingSec = Math.ceil(remainingRows / throughput);
    }

    // 如果任务已完成，预计剩余时间为 0
    const isCompleted = ['COMPLETED', 'FAILED', 'PARTIAL_SUCCESS'].includes(t.status);
    if (isCompleted) {
      estimatedRemainingSec = 0;
    }

    // 降级 SKU 行数：DB 优先，Redis 兜底
    let degradedSkuRows = parseInt(t.degraded_sku_rows ?? '0', 10);
    if (degradedSkuRows === 0 && t.degraded) {
      degradedSkuRows = await getDegradedSkuRowCount(taskId);
    }

    const response: TaskProgressResponse = {
      taskId: t.id,
      fileName: t.file_name,
      status: t.status,
      totalRows: t.total_rows,
      processedRows: t.processed_rows,
      successRows: t.success_rows,
      failedRows: t.failed_rows,
      totalBatches: t.total_batches,
      completedBatches: t.completed_batches,
      degraded: t.degraded ?? false,
      degradedReason: t.degraded_reason || undefined,
      degradedSkuRows,
      traceId: t.trace_id,
      createdAt: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
      completedAt: t.completed_at
        ? (t.completed_at instanceof Date ? t.completed_at.toISOString() : String(t.completed_at))
        : undefined,
      throughput,
      estimatedRemainingSec,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error('[TaskDetail] 查询任务详情失败:', e);
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}

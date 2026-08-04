/**
 * GET /api/traces/search
 *
 * 模块九：全链路 Trace 全局搜索 API
 *
 * 查询参数：
 *   taskId    - 任务 ID
 *   fileName  - 文件名（模糊匹配）
 *   batchIndex- 批次号
 *   rowFrom   - 行号范围起始
 *   rowTo     - 行号范围结束
 *   errorCode - 错误码
 *   page      - 页码（默认 1）
 *   pageSize  - 每页条数（默认 20）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get('taskId') || '';
  const fileName = url.searchParams.get('fileName') || '';
  const batchIndex = url.searchParams.get('batchIndex');
  const rowFrom = url.searchParams.get('rowFrom');
  const rowTo = url.searchParams.get('rowTo');
  const errorCode = url.searchParams.get('errorCode') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  try {
    const sql = await getSql();

    // 构建搜索条件
    // 策略：从 import_tasks + import_task_errors 两张表联合搜索
    // 如果有 taskId / fileName → 定位 import_tasks → 获取 trace_id 集合
    // 如果有 batchIndex / rowFrom / rowTo / errorCode → 定位 import_task_errors → 获取 trace_id 集合
    // 交集合并，分页返回

    let traceIdSet = new Set<string>();

    const allParams = [taskId, fileName, batchIndex, rowFrom, rowTo, errorCode];
    const hasTaskParams = !!(taskId || fileName);
    const hasErrorParams = !!(batchIndex || rowFrom || rowTo || errorCode);
    const hasAnyParam = hasTaskParams || hasErrorParams;

    if (hasAnyParam) {
      // 从任务表搜索
      if (hasTaskParams) {
        const taskConditions: any[] = [];
        if (taskId) taskConditions.push(sql`id = ${taskId}`);
        if (fileName) taskConditions.push(sql`file_name ILIKE ${'%' + fileName + '%'}`);

        const whereClause = taskConditions.reduce((prev, curr) => sql`${prev} AND ${curr}`);
        const taskRows = await sql`
          SELECT trace_id FROM import_tasks WHERE ${whereClause}
        `;
        for (const r of taskRows) traceIdSet.add(r.trace_id);
      }

      // 从错误表搜索
      if (hasErrorParams) {
        const errorConditions: any[] = [];
        if (errorCode) errorConditions.push(sql`error_code = ${errorCode}`);
        if (batchIndex) errorConditions.push(sql`batch_index = ${parseInt(batchIndex)}`);
        if (rowFrom) errorConditions.push(sql`row_number >= ${parseInt(rowFrom)}`);
        if (rowTo) errorConditions.push(sql`row_number <= ${parseInt(rowTo)}`);

        const whereClause = errorConditions.reduce((prev, curr) => sql`${prev} AND ${curr}`);
        const errorRows = await sql`
          SELECT DISTINCT trace_id FROM import_task_errors WHERE ${whereClause}
        `;
        const errorTraceIds = new Set((errorRows as any[]).map((r: any) => r.trace_id));

        // 如果同时有任务参数和错误参数 → 取交集
        if (hasTaskParams) {
          traceIdSet = new Set([...traceIdSet].filter((id) => errorTraceIds.has(id)));
        } else {
          traceIdSet = errorTraceIds;
        }
      }

      if (traceIdSet.size === 0) {
        return NextResponse.json({ code: 0, data: { items: [], total: 0, page, pageSize } });
      }
    }

    // 构建查询：import_tasks + 错误数聚合
    let queryBase: any;
    if (hasAnyParam) {
      const traceIds = [...traceIdSet];
      queryBase = sql`
        SELECT t.id, t.file_name, t.status, t.trace_id, t.total_rows,
               t.success_rows, t.failed_rows, t.total_batches, t.created_at, t.completed_at,
               COALESCE(ec.cnt, 0) as error_count
        FROM import_tasks t
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as cnt FROM import_task_errors e WHERE e.task_id = t.id
        ) ec ON true
        WHERE t.trace_id = ANY(${traceIds}::text[])
      `;
    } else {
      // 无参数 → 返回最近任务
      queryBase = sql`
        SELECT t.id, t.file_name, t.status, t.trace_id, t.total_rows,
               t.success_rows, t.failed_rows, t.total_batches, t.created_at, t.completed_at,
               COALESCE(ec.cnt, 0) as error_count
        FROM import_tasks t
        LEFT JOIN LATERAL (
          SELECT COUNT(*) as cnt FROM import_task_errors e WHERE e.task_id = t.id
        ) ec ON true
      `;
    }

    // 计数
    const countResult = await sql`SELECT COUNT(*) as total FROM (${queryBase}) sub`;
    const total = parseInt(countResult[0]?.total || '0');

    // 分页
    const items = await sql`
      ${queryBase}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const results = (Array.isArray(items) ? items : []).map((r: any) => ({
      traceId: r.trace_id,
      taskId: r.id,
      fileName: r.file_name,
      status: r.status,
      totalRows: r.total_rows,
      successRows: r.success_rows,
      failedRows: r.failed_rows,
      errorCount: parseInt(r.error_count || '0'),
      totalBatches: r.total_batches,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      completedAt: r.completed_at
        ? (r.completed_at instanceof Date ? r.completed_at.toISOString() : String(r.completed_at))
        : null,
    }));

    return NextResponse.json({
      code: 0,
      data: { items: results, total, page, pageSize },
    });
  } catch (e) {
    console.error('[TraceSearch] 搜索失败:', e);
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

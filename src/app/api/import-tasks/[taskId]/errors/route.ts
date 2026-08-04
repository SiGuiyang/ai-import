/**
 * GET /api/import-tasks/[taskId]/errors
 * 查询导入任务的错误明细，支持按批次、错误码筛选和分页
 *
 * 查询参数：
 *   batch     - 批次号筛选
 *   errorCode - 错误码筛选
 *   page      - 页码（默认 1）
 *   pageSize  - 每页条数（默认 50，最大 100）
 */

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { ERROR_CODES, SUGGESTED_FIXES } from '@/lib/types';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { code: 400, message: '缺少 taskId 参数' },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const batch = parseInt(url.searchParams.get('batch') || '');
    const errorCode = url.searchParams.get('errorCode') || '';
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '50'), 100);
    const offset = (page - 1) * pageSize;

    await initDB();
    const sql = await getSql();

    let errors: any[] = [];
    let total = 0;

    try {
      // 构建查询条件
      const conditions = ['task_id = ' + sql`${taskId}`];
      if (!isNaN(batch)) {
        conditions.push('batch_index = ' + sql`${batch}`);
      }
      if (errorCode) {
        conditions.push('error_code = ' + sql`${errorCode}`);
      }

      const whereClause = conditions.join(' AND ');

      // 查询总数
      const countResult = await sql.raw(
        `SELECT COUNT(*) as cnt FROM import_task_errors WHERE ${whereClause}`
      );
      total = countResult.rows?.[0]?.cnt || countResult[0]?.cnt || 0;

      // 分页查询
      errors = await sql.raw(
        `SELECT * FROM import_task_errors WHERE ${whereClause}
         ORDER BY batch_index, row_number
         LIMIT ${pageSize} OFFSET ${offset}`
      );

      // 兼容不同 neon 版本返回格式
      if (errors.rows) errors = errors.rows;
      if (Array.isArray(errors) && errors.length > 0 && errors[0].rows) {
        errors = errors[0].rows;
      }
    } catch {
      errors = [];
    }

    const list = errors.map((e: any) => ({
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
      suggestedFix: e.suggested_fix || SUGGESTED_FIXES[e.error_code] || '请检查数据后重试',
      traceId: e.trace_id,
      createdAt: e.created_at,
    }));

    // 错误码分布统计
    let errorStats: { errorCode: string; errorName: string; count: number }[] = [];
    try {
      const stats = await sql`
        SELECT error_code, COUNT(*) as cnt
        FROM import_task_errors WHERE task_id = ${taskId}
        GROUP BY error_code ORDER BY cnt DESC
      `;
      errorStats = stats.map((s: any) => ({
        errorCode: s.error_code,
        errorName: ERROR_CODES[s.error_code] || s.error_code,
        count: parseInt(s.cnt),
      }));
    } catch {
      errorStats = [];
    }

    return NextResponse.json({
      code: 0,
      data: { list, total, page, pageSize, errorStats },
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

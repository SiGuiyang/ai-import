/**
 * GET /api/traces - Trace 列表查询（模块8: 全链路追踪）
 */
import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get('search') || '';
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const page = parseInt(url.searchParams.get('page') || '1');

    await initDB();
    const sql = await getSql();

    let traces: any[] = [];

    try {
      if (search) {
        traces = await sql`
          SELECT id, trace_id, task_id, unit_id, event_name, event_status,
                 message, occurred_at,
                 COALESCE(duration_ms, 0) AS duration_ms
          FROM trace_events
          WHERE trace_id ILIKE ${'%' + search + '%'}
             OR task_id ILIKE ${'%' + search + '%'}
          ORDER BY occurred_at DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;
      } else {
        traces = await sql`
          SELECT id, trace_id, task_id, unit_id, event_name, event_status,
                 message, occurred_at,
                 COALESCE(duration_ms, 0) AS duration_ms
          FROM trace_events
          ORDER BY occurred_at DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;
      }
    } catch (e) {
      console.error('[Traces] DB查询失败:', e);
      traces = [];
    }

    const data = (traces || []).map((t: any) => ({
      traceId: t.trace_id,
      taskId: t.task_id,
      eventName: t.event_name,
      eventStatus: t.event_status,
      durationMs: parseInt(String(t.duration_ms || '0')),
      createdAt: t.occurred_at,
    }));

    return NextResponse.json({
      code: 0,
      data,
    });
  } catch (e) {
    console.error('[Traces] 查询失败:', e);
    return NextResponse.json({ code: 500, data: [], error: String(e) }, { status: 500 });
  }
}

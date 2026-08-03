/**
 * 全链路 Trace 工具
 *
 * traceId 贯穿整个导入链路：上传 API → Outbox → Queue → Worker → DB
 */

import { v4 as uuidv4 } from 'uuid';
import { getSql } from './db';

/** 生成 traceId */
export function generateTraceId(): string {
  return `trace_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
}

/** 生成 taskId */
export function generateTaskId(): string {
  return `task_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

/** 生成 unitId */
export function generateUnitId(batchIndex: number): string {
  return `unit_${String(batchIndex).padStart(4, '0')}_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
}

/** 记录 Trace 时间线事件（非阻塞，忽略写入失败） */
export async function logTraceEvent(params: {
  traceId: string;
  taskId?: string;
  unitId?: string;
  eventName: string;
  eventStatus: 'STARTED' | 'SUCCEEDED' | 'FAILED';
  message?: string;
}): Promise<void> {
  try {
    const sql = await getSql();
    const id = `tev_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
    await sql`
      INSERT INTO trace_events (id, trace_id, task_id, unit_id, event_name, event_status, message)
      VALUES (${id}, ${params.traceId}, ${params.taskId || null}, ${params.unitId || null},
              ${params.eventName}, ${params.eventStatus}, ${params.message || null})
    `;
  } catch {
    // 非阻塞：trace 写入失败不影响主流程
  }
}

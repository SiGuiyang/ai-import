import { db } from "@/lib/db";
import { traceEvents } from "@/lib/db/schema";
import { v4 as uuidv4 } from "uuid";

export interface TraceEventData {
  traceId: string;
  taskId?: string;
  shardIndex?: number;
  eventName: string;
  eventStatus?: string;
  message?: string;
  metadata?: Record<string, any>;
}

/**
 * 生成全局 traceId
 */
export function generateTraceId(): string {
  return uuidv4().replace(/-/g, "");
}

/**
 * 写入一条链路事件（异步，不阻塞主流程）
 */
export function addTraceEvent(data: TraceEventData): void {
  const event = {
    traceId: data.traceId,
    taskId: data.taskId || null,
    shardIndex: data.shardIndex ?? null,
    eventName: data.eventName,
    eventStatus: data.eventStatus || "ok",
    message: data.message || null,
    metadata: data.metadata || null,
    occurredAt: new Date(),
  };

  // Fire-and-forget：不阻塞主流程
  db.insert(traceEvents).values(event).execute().catch((err) => {
    console.error("[Trace] Failed to insert trace event:", err);
  });
}

/**
 * 查询某条 trace 的全部事件
 */
export async function queryTrace(
  traceId: string,
  options?: { limit?: number; offset?: number }
) {
  const { traceEvents: te } = await import("@/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");

  const limit = options?.limit ?? 500;
  const offset = options?.offset ?? 0;

  return db
    .select()
    .from(te)
    .where(eq(te.traceId, traceId))
    .orderBy(desc(te.occurredAt))
    .limit(limit)
    .offset(offset);
}

/**
 * 按 taskId 查询关联 trace
 */
export async function queryTracesByTask(taskId: string) {
  const { traceEvents: te } = await import("@/lib/db/schema");
  const { eq, desc } = await import("drizzle-orm");

  return db
    .select()
    .from(te)
    .where(eq(te.taskId, taskId as any))
    .orderBy(desc(te.occurredAt))
    .limit(1000);
}

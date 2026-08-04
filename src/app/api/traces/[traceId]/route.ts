import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { traceEvents, importTasks } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/traces/:traceId
 * 返回某个 trace 的完整事件时间线
 *
 * 支持按 traceId 或 taskId 查询（通过 ?type=task 指定）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { traceId: string } }
) {
  try {
    const { traceId } = params;
    const { searchParams } = new URL(request.url);
    const queryType = searchParams.get("type") || "trace"; // "trace" | "task"

    let events: any[] = [];
    let task: any = null;

    if (queryType === "task") {
      // 按 taskId 查询
      events = await db
        .select()
        .from(traceEvents)
        .where(eq(traceEvents.taskId, traceId as any))
        .orderBy(desc(traceEvents.occurredAt))
        .limit(1000);

      const [t] = await db
        .select()
        .from(importTasks)
        .where(eq(importTasks.id, traceId as any));

      if (t) {
        task = t;
        // 如果有 traceId，也查 trace 事件
        if (t.traceId) {
          const traceEvts = await db
            .select()
            .from(traceEvents)
            .where(eq(traceEvents.traceId, t.traceId))
            .orderBy(desc(traceEvents.occurredAt));
          events = [...traceEvts, ...events];
        }
      }
    } else {
      // 按 traceId 查询
      events = await db
        .select()
        .from(traceEvents)
        .where(eq(traceEvents.traceId, traceId))
        .orderBy(desc(traceEvents.occurredAt))
        .limit(1000);

      if (events.length > 0 && events[0].taskId) {
        const [t] = await db
          .select()
          .from(importTasks)
          .where(eq(importTasks.id, events[0].taskId as any));
        task = t;
      }
    }

    // 按时间正序排列（方便看时间线）
    events.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
    );

    return NextResponse.json({
      traceId: queryType === "task" ? task?.traceId : traceId,
      taskId: queryType === "task" ? traceId : task?.id,
      task,
      events,
      eventCount: events.length,
    });
  } catch (error: any) {
    console.error("[Trace] Query failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to query trace" },
      { status: 500 }
    );
  }
}

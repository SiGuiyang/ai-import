import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  traceEvents,
  importTasks,
  importTaskErrors,
} from "@/lib/db/schema";
import { and, between, desc, eq, ilike, inArray } from "drizzle-orm";

/**
 * GET /api/traces/search?type=fileName&q=xxx
 *
 * 高级检索（考试要求：按文件名 / 批次号 / 行号范围 / 错误码搜索）：
 * - type=fileName   q=文件名关键字（模糊匹配），返回任务列表
 * - type=shard      q=taskId:shardIndex（批次号），返回该分片事件时间线 + 行级错误
 * - type=rowRange   q=start-end（行号范围），返回该范围内错误明细及关联任务
 * - type=errorCode  q=错误码（如 E001），返回该错误码的错误明细及关联任务
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "fileName";
    const q = (searchParams.get("q") || "").trim();

    if (!q) {
      return NextResponse.json(
        { error: "缺少搜索关键字 q" },
        { status: 400 }
      );
    }

    // ========== 按批次号（分片）搜索 ==========
    if (type === "shard") {
      const [taskId, shardIdx] = q.split(":");
      if (!taskId || !shardIdx || Number.isNaN(Number(shardIdx))) {
        return NextResponse.json(
          { error: "批次搜索格式应为 taskId:shardIndex，例如 xxx-xxx:2" },
          { status: 400 }
        );
      }
      const shardIndex = Number(shardIdx);

      const [task] = await db
        .select()
        .from(importTasks)
        .where(eq(importTasks.id, taskId as any));

      const events = await db
        .select()
        .from(traceEvents)
        .where(
          and(
            eq(traceEvents.taskId, taskId as any),
            eq(traceEvents.shardIndex, shardIndex)
          )
        )
        .orderBy(desc(traceEvents.occurredAt));

      const errors = await db
        .select()
        .from(importTaskErrors)
        .where(
          and(
            eq(importTaskErrors.taskId, taskId as any),
            eq(importTaskErrors.shardIndex, shardIndex)
          )
        )
        .orderBy(desc(importTaskErrors.rowNumber))
        .limit(500);

      return NextResponse.json({
        type,
        tasks: task ? [task] : [],
        events,
        errors,
        task,
      });
    }

    // ========== 按行号范围搜索 ==========
    if (type === "rowRange") {
      const m = q.match(/^(\d+)-(\d+)$/);
      if (!m) {
        return NextResponse.json(
          { error: "行号范围格式应为 start-end，例如 100-200" },
          { status: 400 }
        );
      }
      const start = Number(m[1]);
      const end = Number(m[2]);

      const errors = await db
        .select()
        .from(importTaskErrors)
        .where(between(importTaskErrors.rowNumber, start, end))
        .orderBy(desc(importTaskErrors.rowNumber))
        .limit(500);

      const taskIds = [...new Set(errors.map((e) => e.taskId))] as any[];
      const tasks = taskIds.length
        ? await db
            .select()
            .from(importTasks)
            .where(inArray(importTasks.id, taskIds))
        : [];

      return NextResponse.json({ type, tasks, errors, events: [], task: null });
    }

    // ========== 按错误码搜索 ==========
    if (type === "errorCode") {
      const code = q.toUpperCase();
      const errors = await db
        .select()
        .from(importTaskErrors)
        .where(ilike(importTaskErrors.errorCode, `%${code}%`))
        .orderBy(desc(importTaskErrors.createdAt))
        .limit(500);

      const taskIds = [...new Set(errors.map((e) => e.taskId))] as any[];
      const tasks = taskIds.length
        ? await db
            .select()
            .from(importTasks)
            .where(inArray(importTasks.id, taskIds))
        : [];

      return NextResponse.json({ type, tasks, errors, events: [], task: null });
    }

    // ========== 按文件名搜索（默认） ==========
    const tasks = await db
      .select()
      .from(importTasks)
      .where(ilike(importTasks.fileName, `%${q}%`))
      .orderBy(desc(importTasks.createdAt))
      .limit(50);

    return NextResponse.json({
      type,
      tasks,
      errors: [],
      events: [],
      task: null,
    });
  } catch (error: any) {
    console.error("[Trace] Search failed:", error);
    return NextResponse.json(
      { error: error.message || "搜索失败" },
      { status: 500 }
    );
  }
}

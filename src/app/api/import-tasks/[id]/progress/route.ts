import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks, importTaskShards } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;

    // 查询任务主体
    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, id));

    if (!task) {
      return NextResponse.json(
        { success: false, error: "任务不存在" },
        { status: 404 }
      );
    }

    // 查询分片进度
    const shards = await db
      .select()
      .from(importTaskShards)
      .where(eq(importTaskShards.taskId, id))
      .orderBy(importTaskShards.shardIndex);

    const completed = shards.filter((s) => s.status === "completed").length;
    const failed = shards.filter((s) => s.status === "failed").length;
    const total = shards.length;

    // 计算预估剩余时间
    let estimatedRemaining: number | null = null;
    if (total > 0 && completed > 0 && completed < total) {
      const elapsed = task.createdAt
        ? Date.now() - new Date(task.createdAt).getTime()
        : 0;
      const rate = completed / (elapsed / 1000); // 分片/秒
      if (rate > 0) {
        estimatedRemaining = Math.round((total - completed) / rate);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalRows: task.totalRows || 0,
        processedRows: task.processedRows || 0,
        fileName: task.fileName,
        shards: {
          total,
          completed,
          failed,
          processing: total - completed - failed,
        },
        estimatedRemaining,
        degraded: task.degraded || false,
        error: task.error || null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt || null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

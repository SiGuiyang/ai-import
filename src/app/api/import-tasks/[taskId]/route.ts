import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks } from "@/lib/db/schema";

/**
 * GET /api/import-tasks/:taskId
 * 查询导入任务详情和进度
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;
    const { eq } = await import("drizzle-orm");

    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 计算进度百分比
    const progress =
      task.totalShards > 0
        ? Math.round((task.completedShards / task.totalShards) * 100)
        : 0;

    // 计算预估剩余时间（基于已完成的 shard 的平均耗时）
    let estimatedRemainingSeconds: number | null = null;
    if (task.startedAt && task.completedShards > 0 && task.status === "processing") {
      const elapsedMs = Date.now() - new Date(task.startedAt).getTime();
      const avgMsPerShard = elapsedMs / task.completedShards;
      const remainingShards = task.totalShards - task.completedShards;
      estimatedRemainingSeconds = Math.round((avgMsPerShard * remainingShards) / 1000);
    }

    return NextResponse.json({
      task,
      progress,
      estimatedRemainingSeconds,
    });
  } catch (error: any) {
    console.error("[ImportTask] Query failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to query task" },
      { status: 500 }
    );
  }
}

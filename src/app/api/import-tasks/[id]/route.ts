import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;

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

    return NextResponse.json({
      task,
      progress: task.totalShards > 0
        ? Math.round((task.completedShards / task.totalShards) * 100)
        : 0,
      estimatedRemainingSeconds: null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

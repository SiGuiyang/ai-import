import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTaskShards, batchPerformanceLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/import-tasks/:taskId/shards
 * 返回各处理单元（shard）的状态和性能数据
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;

    const [shards, perfLogs] = await Promise.all([
      db
        .select()
        .from(importTaskShards)
        .where(eq(importTaskShards.taskId, taskId))
        .orderBy(importTaskShards.shardIndex as any) as any,
      db
        .select()
        .from(batchPerformanceLog)
        .where(eq(batchPerformanceLog.taskId, taskId))
        .orderBy(batchPerformanceLog.shardIndex as any) as any,
    ]);

    // 合并性能数据
    const perfMap = new Map<number, any>();
    perfLogs.forEach((log: any) => {
      perfMap.set(log.shardIndex, log);
    });

    const shardsWithPerf = shards.map((s: any) => ({
      ...s,
      performance: perfMap.get(s.shardIndex) || null,
    }));

    // 计算阶段耗时统计
    let stats: any = null;
    if (perfLogs.length > 0) {
      const durations = {
        parse: perfLogs
          .map((l: any) => l.parseDurationMs)
          .filter(Boolean) as number[],
        rule: perfLogs
          .map((l: any) => l.ruleDurationMs)
          .filter(Boolean) as number[],
        validate: perfLogs
          .map((l: any) => l.validateDurationMs)
          .filter(Boolean) as number[],
        insert: perfLogs
          .map((l: any) => l.insertDurationMs)
          .filter(Boolean) as number[],
        total: perfLogs
          .map((l: any) => l.totalDurationMs)
          .filter(Boolean) as number[],
      };

      const p = (arr: number[], percentile: number) => {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
      };

      stats = {
        parse: { p50: p(durations.parse, 50), p95: p(durations.parse, 95), p99: p(durations.parse, 99) },
        rule: { p50: p(durations.rule, 50), p95: p(durations.rule, 95), p99: p(durations.rule, 99) },
        validate: { p50: p(durations.validate, 50), p95: p(durations.validate, 95), p99: p(durations.validate, 99) },
        insert: { p50: p(durations.insert, 50), p95: p(durations.insert, 95), p99: p(durations.insert, 99) },
        total: { p50: p(durations.total, 50), p95: p(durations.total, 95), p99: p(durations.total, 99) },
      };
    }

    return NextResponse.json({
      shards: shardsWithPerf,
      stats,
    });
  } catch (error: any) {
    console.error("[Shards] Query failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to query shards" },
      { status: 500 }
    );
  }
}

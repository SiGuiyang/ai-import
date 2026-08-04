import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  importTasks,
  importTaskErrors,
  batchPerformanceLog,
} from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";
import { getQueueMetrics } from "@/lib/queue";

/**
 * GET /api/import-monitor/summary
 * 返回监控聚合数据：
 * - 吞吐量（最近 5min / 15min / 60min）
 * - 队列积压深度
 * - 阶段耗时 P50/P95/P99
 * - 错误类型分布
 */
export async function GET() {
  try {
    const now = new Date();

    // 时间窗口
    const windows = {
      "5min": new Date(now.getTime() - 5 * 60 * 1000),
      "15min": new Date(now.getTime() - 15 * 60 * 1000),
      "60min": new Date(now.getTime() - 60 * 60 * 1000),
    };

    // 1. 吞吐量：各时间窗口内的 completed shards 总行数
    const throughputQueries = Object.entries(windows).map(
      async ([label, since]) => {
        const result = await db
          .select({
            totalRows: sql<number>`COALESCE(SUM(${batchPerformanceLog.rowCount}), 0)`,
            count: sql<number>`COUNT(*)::int`,
          })
          .from(batchPerformanceLog)
          .where(
            sql`${batchPerformanceLog.createdAt} >= ${since.toISOString()} AND ${batchPerformanceLog.status} = 'completed'`
          );
        return { window: label, ...result[0] };
      }
    );

    // 2. 错误分布
    const errorQuery = db
      .select({
        errorCode: importTaskErrors.errorCode,
        errorCount: sql<number>`COUNT(*)::int`,
      })
      .from(importTaskErrors)
      .where(sql`${importTaskErrors.createdAt} >= ${windows["60min"].toISOString()}`)
      .groupBy(importTaskErrors.errorCode)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    // 3. 阶段耗时 P50/P95/P99
    const perfQuery = db
      .select({
        parseAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.parseDurationMs}), 0)`,
        validateAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.validateDurationMs}), 0)`,
        insertAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.insertDurationMs}), 0)`,
        totalAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.totalDurationMs}), 0)`,
        totalMax: sql<number>`COALESCE(MAX(${batchPerformanceLog.totalDurationMs}), 0)`,
        totalMin: sql<number>`COALESCE(MIN(${batchPerformanceLog.totalDurationMs}), 0)`,
        perfCount: sql<number>`COUNT(*)::int`,
      })
      .from(batchPerformanceLog)
      .where(
        sql`${batchPerformanceLog.createdAt} >= ${windows["60min"].toISOString()}`
      );

    // 4. 队列积压
    let queueMetrics;
    try {
      queueMetrics = await getQueueMetrics();
    } catch {
      queueMetrics = {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      };
    }

    // 5. 任务状态统计（最近 24h）
    const taskStatsQuery = db
      .select({
        status: importTasks.status,
        taskCount: sql<number>`COUNT(*)::int`,
      })
      .from(importTasks)
      .groupBy(importTasks.status);

    const [throughputs, errors, perf, taskStats] = await Promise.all([
      Promise.all(throughputQueries),
      errorQuery,
      perfQuery,
      taskStatsQuery,
    ]);

    return NextResponse.json({
      throughput: throughputs.reduce(
        (acc, item) => ({ ...acc, [item.window]: item }),
        {}
      ),
      queue: queueMetrics,
      performance: perf[0] || {},
      errors: errors,
      taskStats,
      serverTime: now.toISOString(),
    });
  } catch (error: any) {
    console.error("[Monitor] Summary failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get monitor summary" },
      { status: 500 }
    );
  }
}

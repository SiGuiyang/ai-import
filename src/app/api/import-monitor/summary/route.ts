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
 * - 任务统计（最近 24h）
 * - 最近任务 Top N
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

    // 3. 阶段耗时 P50/P95/P99（真实百分位计算）
    const perfQuery = db
      .select({
        parseAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.parseDurationMs}), 0)`,
        parseP50: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${batchPerformanceLog.parseDurationMs}), 0)`,
        parseP95: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${batchPerformanceLog.parseDurationMs}), 0)`,
        parseP99: sql<number>`COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${batchPerformanceLog.parseDurationMs}), 0)`,
        ruleAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.ruleDurationMs}), 0)`,
        ruleP50: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${batchPerformanceLog.ruleDurationMs}), 0)`,
        ruleP95: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${batchPerformanceLog.ruleDurationMs}), 0)`,
        ruleP99: sql<number>`COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${batchPerformanceLog.ruleDurationMs}), 0)`,
        validateAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.validateDurationMs}), 0)`,
        validateP50: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${batchPerformanceLog.validateDurationMs}), 0)`,
        validateP95: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${batchPerformanceLog.validateDurationMs}), 0)`,
        validateP99: sql<number>`COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${batchPerformanceLog.validateDurationMs}), 0)`,
        insertAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.insertDurationMs}), 0)`,
        insertP50: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${batchPerformanceLog.insertDurationMs}), 0)`,
        insertP95: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${batchPerformanceLog.insertDurationMs}), 0)`,
        insertP99: sql<number>`COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${batchPerformanceLog.insertDurationMs}), 0)`,
        totalAvg: sql<number>`COALESCE(AVG(${batchPerformanceLog.totalDurationMs}), 0)`,
        totalP50: sql<number>`COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${batchPerformanceLog.totalDurationMs}), 0)`,
        totalP95: sql<number>`COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${batchPerformanceLog.totalDurationMs}), 0)`,
        totalP99: sql<number>`COALESCE(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY ${batchPerformanceLog.totalDurationMs}), 0)`,
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
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const taskStatsQuery = db
      .select({
        status: importTasks.status,
        taskCount: sql<number>`COUNT(*)::int`,
      })
      .from(importTasks)
      .where(sql`${importTasks.createdAt} >= ${dayAgo.toISOString()}`)
      .groupBy(importTasks.status);

    // 6. 任务聚合统计（最近 24h）
    const taskSummaryQuery = db
      .select({
        totalTasks: sql<number>`COUNT(*)::int`,
        totalRows: sql<number>`COALESCE(SUM(${importTasks.totalRows}), 0)`,
        successRows: sql<number>`COALESCE(SUM(${importTasks.successRows}), 0)`,
        failedRows: sql<number>`COALESCE(SUM(${importTasks.failedRows}), 0)`,
        completedTasks: sql<number>`COUNT(*) FILTER (WHERE ${importTasks.status} = 'completed')::int`,
        failedTasks: sql<number>`COUNT(*) FILTER (WHERE ${importTasks.status} = 'failed')::int`,
      })
      .from(importTasks)
      .where(sql`${importTasks.createdAt} >= ${dayAgo.toISOString()}`);

    // 7. 最近任务 Top 10
    const recentTasksQuery = db
      .select({
        id: importTasks.id,
        fileName: importTasks.fileName,
        fileType: importTasks.fileType,
        status: importTasks.status,
        totalRows: importTasks.totalRows,
        successRows: importTasks.successRows,
        failedRows: importTasks.failedRows,
        createdAt: importTasks.createdAt,
      })
      .from(importTasks)
      .orderBy(desc(importTasks.createdAt))
      .limit(10);

    const [throughputs, errors, perf, taskStats, taskSummary, recentTasks] = await Promise.all([
      Promise.all(throughputQueries),
      errorQuery,
      perfQuery,
      taskStatsQuery,
      taskSummaryQuery,
      recentTasksQuery,
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
      taskSummary: taskSummary[0] || {},
      recentTasks,
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

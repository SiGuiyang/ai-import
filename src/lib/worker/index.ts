import { Worker } from "bullmq";
import { getRedis } from "@/lib/queue/redis";
import {
  IMPORT_QUEUE_NAME,
  ImportShardJobData,
  addShardJob,
} from "@/lib/queue";
import { processShardJob } from "./import-processor";
import { db } from "@/lib/db";
import { importTaskShards, importTasks } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { addTraceEvent } from "@/lib/trace";
import { decideRecoveryAction } from "./pure";

let worker: Worker<ImportShardJobData> | null = null;

// ========== 卡死分片恢复 ==========
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 锁定超过 5 分钟视为卡死
const MAX_RETRIES = 3; // 与 BullMQ attempts 保持一致
let recoveryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 定时扫描 locked 且超时的分片：
 * - retryCount < MAX_RETRIES → 重置为 pending 并重新入队（重投）
 * - 重试耗尽 → 标记 failed，并把该分片行数计入任务失败，推进任务完成
 */
async function recoverStuckShards(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckShards = await db
    .select({
      taskId: importTaskShards.taskId,
      shardIndex: importTaskShards.shardIndex,
      startRow: importTaskShards.startRow,
      endRow: importTaskShards.endRow,
      retryCount: importTaskShards.retryCount,
      traceId: importTasks.traceId,
    })
    .from(importTaskShards)
    .innerJoin(importTasks, eq(importTasks.id, importTaskShards.taskId))
    .where(
      and(
        eq(importTaskShards.status, "locked"),
        sql`${importTaskShards.lockedAt} < ${threshold}`
      )
    )
    .limit(100);

  if (stuckShards.length === 0) return;

  console.log(`[Recovery] Found ${stuckShards.length} stuck shard(s), recovering...`);

  for (const shard of stuckShards) {
    const retryCount = shard.retryCount ?? 0;
    const lockCond = sql`${importTaskShards.taskId} = ${shard.taskId} AND ${importTaskShards.shardIndex} = ${shard.shardIndex} AND ${importTaskShards.status} = 'locked'`;

    if (decideRecoveryAction(retryCount, MAX_RETRIES) === "re-enqueue") {
      // 重投：重置为 pending 并重新入队（仅当仍处于 locked 状态，避免与正在处理的分片竞争）
      const [updated] = await db
        .update(importTaskShards)
        .set({
          status: "pending",
          retryCount: retryCount + 1,
          lockedAt: null,
        } as any)
        .where(lockCond)
        .returning({ id: importTaskShards.id });

      if (!updated) continue; // 已被其他恢复流程处理

      await addShardJob({
        taskId: shard.taskId,
        shardIndex: shard.shardIndex,
        startRow: shard.startRow,
        endRow: shard.endRow,
        traceId: shard.traceId ?? shard.taskId,
      });

      console.log(
        `[Recovery] Re-enqueued stuck shard ${shard.taskId}/${shard.shardIndex} (retry ${retryCount + 1}/${MAX_RETRIES})`
      );
      addTraceEvent({
        traceId: shard.traceId ?? shard.taskId,
        taskId: shard.taskId,
        shardIndex: shard.shardIndex,
        eventName: "SHARD_RECOVERED",
        eventStatus: "warning",
        message: `卡死恢复：分片锁定超时，已重新入队（retry ${retryCount + 1}/${MAX_RETRIES}）`,
      });
    } else {
      // 重试耗尽：标记失败，行数计入任务失败统计
      await db
        .update(importTaskShards)
        .set({ status: "failed", completedAt: new Date() } as any)
        .where(lockCond);

      const rowCount = shard.endRow - shard.startRow + 1;
      await db
        .update(importTasks)
        .set({
          completedShards: sql`completed_shards + 1`,
          processedRows: sql`processed_rows + ${rowCount}`,
          failedRows: sql`failed_rows + ${rowCount}`,
          updatedAt: new Date(),
        } as any)
        .where(eq(importTasks.id, shard.taskId as any));

      console.warn(
        `[Recovery] Stuck shard ${shard.taskId}/${shard.shardIndex} marked failed after ${MAX_RETRIES} retries`
      );
      addTraceEvent({
        traceId: shard.traceId ?? shard.taskId,
        taskId: shard.taskId,
        shardIndex: shard.shardIndex,
        eventName: "SHARD_FAILED_STUCK",
        eventStatus: "error",
        message: `卡死恢复：重试耗尽，分片 ${shard.shardIndex} 标记为失败，${rowCount} 行计入失败`,
      });

      await finalizeTask(shard.taskId);
    }
  }
}

/**
 * 检查任务是否所有分片均已终结（completed/failed），若是则落定最终状态
 */
async function finalizeTask(taskId: string): Promise<void> {
  const [task] = await db
    .select()
    .from(importTasks)
    .where(eq(importTasks.id, taskId as any));
  if (!task) return;

  if ((task.completedShards ?? 0) < (task.totalShards ?? 0)) return;

  const newStatus = (task.failedRows ?? 0) > 0 ? "partial_success" : "completed";
  await db
    .update(importTasks)
    .set({
      status: newStatus,
      degraded: task.degraded || false,
      completedAt: new Date(),
      updatedAt: new Date(),
    } as any)
    .where(eq(importTasks.id, taskId as any));

  addTraceEvent({
    traceId: task.traceId ?? taskId,
    taskId,
    eventName: "TASK_COMPLETED",
    message: `Task completed (via recovery): ${task.completedShards}/${task.totalShards} shards, success=${task.successRows}, failed=${task.failedRows}, status=${newStatus}`,
  });
}

/**
 * 启动卡死恢复定时器（幂等，只注册一次）
 */
export function startStuckShardRecovery(
  intervalMs: number = 60 * 1000
): ReturnType<typeof setInterval> {
  if (recoveryTimer) return recoveryTimer;

  recoveryTimer = setInterval(async () => {
    try {
      await recoverStuckShards();
    } catch (err: any) {
      console.error("[Recovery] scan failed:", err.message);
    }
  }, intervalMs);

  // 启动时立即扫描一次
  recoverStuckShards().catch((err: any) => {
    console.error("[Recovery] initial scan failed:", err.message);
  });

  console.log(`[Recovery] Stuck-shard recovery started (interval=${intervalMs}ms, threshold=${STUCK_THRESHOLD_MS}ms)`);
  return recoveryTimer;
}

/**
 * 创建并启动 Worker
 * concurrency: 2（并行处理 2 个 Job）
 */
export function createWorker(concurrency = 2): Worker<ImportShardJobData> {
  if (worker) return worker;

  const connection = getRedis();

  worker = new Worker<ImportShardJobData>(
    IMPORT_QUEUE_NAME,
    async (job) => {
      console.log(
        `[Worker] Processing job ${job.id}: shard ${job.data.shardIndex}`
      );
      await processShardJob(job);
    },
    {
      connection,
      concurrency,
      // 移除已完成/失败的 Job（保留最近 1000/500）
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
      // 失败重试已在 Queue 级别配置
      // Worker 级别的错误处理
      limiter: {
        // 每 100ms 最多处理 1 个 job（避免数据库压力）
        max: 1,
        duration: 100,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed: shard ${job.data.shardIndex}`);
  });

  worker.on("failed", (job, err) => {
    if (job) {
      console.error(
        `[Worker] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`
      );
    }
  });

  worker.on("error", (err) => {
    console.error("[Worker] Worker error:", err.message);
  });

  console.log(
    `[Worker] Started with concurrency=${concurrency}, queue=${IMPORT_QUEUE_NAME}`
  );

  // 启动卡死分片恢复定时器
  startStuckShardRecovery();

  return worker;
}

/**
 * 优雅关闭 Worker
 */
export async function shutdownWorker(): Promise<void> {
  if (recoveryTimer) {
    clearInterval(recoveryTimer);
    recoveryTimer = null;
    console.log("[Worker] Stuck-shard recovery stopped");
  }
  if (worker) {
    console.log("[Worker] Shutting down...");
    await worker.close();
    worker = null;
    console.log("[Worker] Shut down");
  }
}

import { Worker } from "bullmq";
import { getRedis } from "@/lib/queue/redis";
import { IMPORT_QUEUE_NAME, ImportShardJobData } from "@/lib/queue";
import { processShardJob } from "./import-processor";

let worker: Worker<ImportShardJobData> | null = null;

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

  return worker;
}

/**
 * 优雅关闭 Worker
 */
export async function shutdownWorker(): Promise<void> {
  if (worker) {
    console.log("[Worker] Shutting down...");
    await worker.close();
    worker = null;
    console.log("[Worker] Shut down");
  }
}

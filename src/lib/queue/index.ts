import { Queue } from "bullmq";
import { getRedis } from "./redis";

// ========== Job 数据类型 ==========
export interface ImportShardJobData {
  taskId: string;
  shardIndex: number;
  startRow: number;
  endRow: number;
  traceId: string;
}

// ========== 队列名称 ==========
export const IMPORT_QUEUE_NAME = "import-shards";

// ========== 队列单例 ==========
let importQueue: Queue<ImportShardJobData> | null = null;

export function getImportQueue(): Queue<ImportShardJobData> {
  if (!importQueue) {
    const connection = getRedis();
    importQueue = new Queue<ImportShardJobData>(IMPORT_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return importQueue;
}

// ========== 队列辅助方法 ==========
export async function addShardJob(data: ImportShardJobData): Promise<void> {
  const queue = getImportQueue();
  await queue.add(`shard-${data.taskId}-${data.shardIndex}`, data, {
    jobId: `shard-${data.taskId}-${data.shardIndex}`,
  });
}

export async function addShardJobs(
  jobs: ImportShardJobData[]
): Promise<void> {
  const queue = getImportQueue();
  const batch = jobs.map((data) => ({
    name: `shard-${data.taskId}-${data.shardIndex}`,
    data,
    opts: { jobId: `shard-${data.taskId}-${data.shardIndex}` },
  }));
  await queue.addBulk(batch);
}

export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getImportQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

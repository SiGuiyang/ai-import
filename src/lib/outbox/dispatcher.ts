/**
 * Outbox 分发器
 *
 * 从 event_outbox 表中读取 pending 事件，投递到 BullMQ 队列。
 * 可用作独立的 cron job 或在 Worker 进程中作为定时器。
 * 如果上传 API 已经直接入队，则此分发器作为补偿机制。
 */

import { db } from "@/lib/db";
import { eventOutbox } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getImportQueue } from "@/lib/queue";
import type { ImportShardJobData } from "@/lib/queue";

const BATCH_SIZE = 100;
const POLL_INTERVAL_MS = 1000;

/**
 * 分发一批 pending 事件到 BullMQ
 */
export async function dispatchOutboxBatch(limit = BATCH_SIZE): Promise<{
  dispatched: number;
  failed: number;
}> {
  const queue = getImportQueue();

  // 读取 pending 事件
  const events = await db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.status, "pending"))
    .orderBy(asc(eventOutbox.createdAt))
    .limit(limit);

  let dispatched = 0;
  let failed = 0;

  for (const event of events) {
    try {
      const payload = event.payload as ImportShardJobData;

      if (event.eventType === "IMPORT_SHARD_CREATED") {
        await queue.add(
          `shard-${payload.taskId}-${payload.shardIndex}`,
          payload,
          { jobId: `shard-${payload.taskId}-${payload.shardIndex}` }
        );
      }

      // 更新状态为 sent
      await db
        .update(eventOutbox)
        .set({
          status: "sent",
          sentAt: new Date(),
        } as any)
        .where(eq(eventOutbox.id, event.id));

      dispatched++;
    } catch (err: any) {
      console.error(
        `[Outbox] Failed to dispatch event ${event.id}: ${err.message}`
      );

      // 更新重试计数 + 记录错误原因
      const newRetryCount = (event.retryCount || 0) + 1;
      await db
        .update(eventOutbox)
        .set({
          retryCount: newRetryCount,
          errorMessage: `[${new Date().toISOString()}] ${err.message}`,
          status: newRetryCount >= 5 ? "failed" : "pending",
          nextRetryAt: newRetryCount >= 5
            ? undefined
            : new Date(Date.now() + Math.min(60000, 2000 * Math.pow(2, newRetryCount))),
        } as any)
        .where(eq(eventOutbox.id, event.id));

      failed++;
      // 不抛出，继续处理下一个事件
    }
  }

  if (dispatched > 0 || failed > 0) {
    console.log(
      `[Outbox] Dispatched: ${dispatched}, Failed: ${failed}`
    );
  }

  return { dispatched, failed };
}

/**
 * 启动 outbox 分发循环（用于 Worker 进程内）
 */
export function startOutboxDispatcher(): NodeJS.Timeout {
  console.log(`[Outbox] Dispatcher started (poll every ${POLL_INTERVAL_MS}ms)`);
  return setInterval(() => {
    dispatchOutboxBatch().catch((err) => {
      console.error("[Outbox] Dispatch error:", err.message);
    });
  }, POLL_INTERVAL_MS);
}

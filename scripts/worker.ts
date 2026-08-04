/**
 * Worker 启动脚本
 *
 * 使用方式：
 *   npx tsx scripts/worker.ts
 *
 * 需要环境变量：
 *   DATABASE_URL          - PostgreSQL 连接串
 *   UPSTASH_REDIS_REDIS_URL     - Redis 连接串
 */

import "dotenv/config";
import { createWorker, shutdownWorker } from "../src/lib/worker";

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "2", 10);

async function main() {
  console.log("=".repeat(60));
  console.log("V4 Import Worker");
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log("=".repeat(60));

  // 启动 Worker
  const worker = createWorker(CONCURRENCY);

  // 优雅退出
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Worker] Received ${signal}, shutting down...`);
    await shutdownWorker();
    process.exit(0);
  };

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  console.log("[Worker] Waiting for jobs... (Ctrl+C to stop)");
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});

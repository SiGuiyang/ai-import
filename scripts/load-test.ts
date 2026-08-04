/**
 * 压测脚本
 *
 * 使用方式：
 *   npx tsx scripts/load-test.ts
 *
 * 前提：
 *   - 已运行 seed-data 生成 test-data-10000.xlsx
 *   - 本地或远程 server 已启动
 *
 * 测试流程：
 *   1. 上传 10,000 行 Excel
 *   2. 记录上传响应时间
 *   3. 轮询任务进度直至完成
 *   4. 输出报告
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EXCEL_PATH = path.join(__dirname, "..", "test-data-10000.xlsx");
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时

interface TestReport {
  upload: {
    taskId: string;
    traceId: string;
    totalRows: number;
    totalShards: number;
    uploadDurationMs: number;
    fileName: string;
  };
  processing: {
    totalDurationMs: number;
    estimatedThroughput: string;
    finalStatus: string;
    processedRows: number;
    successRows: number;
    failedRows: number;
    degraded: boolean;
  };
  shards?: Array<{
    index: number;
    status: string;
    totalDurationMs: number;
    rowCount: number;
  }>;
  errors?: Array<{
    errorCode: string;
    count: number;
  }>;
}

async function main() {
  console.log("=".repeat(60));
  console.log("V4 Load Test");
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Excel: ${EXCEL_PATH}`);
  console.log("=".repeat(60));

  const report: TestReport = {
    upload: {} as TestReport["upload"],
    processing: {} as TestReport["processing"],
  };

  // ========== Step 1: 上传文件 ==========
  console.log("\n[1] Uploading file...");
  const uploadStart = Date.now();

  const excelBuffer = fs.readFileSync(EXCEL_PATH);
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const formData = new FormData();
  formData.append(
    "file",
    new File([blob], "test-data-10000.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );

  const uploadRes = await fetch(`${BASE_URL}/api/import-tasks`, {
    method: "POST",
    body: formData,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json();
    throw new Error(`Upload failed: ${err.error || uploadRes.statusText}`);
  }

  const uploadData = await uploadRes.json();
  const uploadDuration = Date.now() - uploadStart;

  report.upload = {
    taskId: uploadData.taskId,
    traceId: uploadData.traceId,
    totalRows: uploadData.totalRows,
    totalShards: uploadData.totalShards,
    uploadDurationMs: uploadDuration,
    fileName: uploadData.fileName,
  };

  console.log(`  Uploaded: ${uploadData.totalRows} rows, ${uploadData.totalShards} shards`);
  console.log(`  Task ID: ${uploadData.taskId}`);
  console.log(`  Trace ID: ${uploadData.traceId}`);
  console.log(`  Upload duration: ${uploadDuration}ms`);

  // ========== Step 2: 轮询进度 ==========
  console.log("\n[2] Polling progress...");
  const startTime = Date.now();
  let lastProgress = 0;
  let lastLogTime = Date.now();

  while (true) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error("Timeout: task did not complete within 5 minutes");
    }

    const taskRes = await fetch(
      `${BASE_URL}/api/import-tasks/${uploadData.taskId}`
    );
    const taskData = await taskRes.json();

    const { task, progress } = taskData;
    const now = Date.now();

    // 速率日志
    if (progress !== lastProgress || now - lastLogTime > 5000) {
      const elapsed = (now - startTime) / 1000;
      console.log(
        `  Progress: ${progress}% | shards: ${task.completedShards}/${task.totalShards} | rows: ${task.processedRows}/${task.totalRows} | elapsed: ${elapsed.toFixed(0)}s`
      );
      lastProgress = progress;
      lastLogTime = now;
    }

    if (task.status === "completed" || task.status === "degraded" || task.status === "failed") {
      const totalDuration = Date.now() - startTime;

      report.processing = {
        totalDurationMs: totalDuration,
        estimatedThroughput: `${Math.round((task.totalRows / totalDuration) * 1000)} rows/s`,
        finalStatus: task.status,
        processedRows: task.processedRows,
        successRows: task.successRows,
        failedRows: task.failedRows,
        degraded: task.degraded,
      };

      // 获取分片性能数据
      try {
        const shardsRes = await fetch(
          `${BASE_URL}/api/import-tasks/${uploadData.taskId}/shards`
        );
        const shardsData = await shardsRes.json();
        report.shards = shardsData.shards?.map((s: any) => ({
          index: s.shardIndex,
          status: s.status,
          totalDurationMs: s.performance?.totalDurationMs || 0,
          rowCount: s.performance?.rowCount || 0,
        }));
        if (shardsData.stats) {
          console.log(`\n  Stage stats:`);
          console.log(`    Total: avg=${Math.round(shardsData.stats.total.p50)}ms, P95=${Math.round(shardsData.stats.total.p95)}ms, P99=${Math.round(shardsData.stats.total.p99)}ms`);
        }
      } catch {}

      // 错误统计
      if (task.failedRows > 0) {
        try {
          const errorsRes = await fetch(
            `${BASE_URL}/api/import-tasks/${uploadData.taskId}/errors?pageSize=1000`
          );
          const errorsData = await errorsRes.json();
          const errorMap = new Map<string, number>();
          errorsData.errors?.forEach((e: any) => {
            errorMap.set(e.errorCode, (errorMap.get(e.errorCode) || 0) + 1);
          });
          report.errors = Array.from(errorMap.entries()).map(([errorCode, count]) => ({
            errorCode,
            count,
          }));
        } catch {}
      }

      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  // ========== Step 3: 输出报告 ==========
  console.log("\n" + "=".repeat(60));
  console.log("LOAD TEST REPORT");
  console.log("=".repeat(60));

  console.log("\n--- Upload ---");
  console.log(`  File: ${report.upload.fileName}`);
  console.log(`  Rows: ${report.upload.totalRows}`);
  console.log(`  Shards: ${report.upload.totalShards}`);
  console.log(`  Upload time: ${report.upload.uploadDurationMs}ms`);

  console.log("\n--- Processing ---");
  console.log(`  Status: ${report.processing.finalStatus}`);
  console.log(`  Duration: ${(report.processing.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Throughput: ${report.processing.estimatedThroughput}`);
  console.log(`  Processed: ${report.processing.processedRows} rows`);
  console.log(`  Success: ${report.processing.successRows}`);
  console.log(`  Failed: ${report.processing.failedRows}`);
  console.log(`  Degraded: ${report.processing.degraded}`);

  if (report.shards) {
    const avgShardMs =
      report.shards.reduce((sum, s) => sum + s.totalDurationMs, 0) /
      report.shards.length;
    console.log(`\n--- Shards ---`);
    console.log(`  Count: ${report.shards.length}`);
    console.log(`  Avg duration: ${Math.round(avgShardMs)}ms`);
    console.log(`  Status: ${report.shards.map((s) => `${s.index}:${s.status}`).join(", ")}`);
  }

  if (report.errors && report.errors.length > 0) {
    console.log("\n--- Errors ---");
    report.errors.forEach((e) => {
      console.log(`  ${e.errorCode}: ${e.count}`);
    });
  }

  console.log("\n--- Summary ---");
  const isOk = report.processing.totalDurationMs / 1000 <= 60;
  console.log(`  < 60s target: ${isOk ? "PASS" : "FAIL"}`);
  console.log(`  Upload < 1s: ${report.upload.uploadDurationMs <= 1000 ? "PASS" : "FAIL"}`);
  console.log("=".repeat(60));

  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});

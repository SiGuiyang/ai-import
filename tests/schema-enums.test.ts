/**
 * Schema 枚举测试：
 * - 任务状态枚举必须包含 partial_success（考试要求）
 * - 分片 / Outbox 状态枚举完整
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(__dirname, "..", "src", "lib", "db", "schema.ts");
const src = readFileSync(SCHEMA_PATH, "utf-8");

test("import_task_status 枚举包含 partial_success", () => {
  const m = src.match(
    /importTaskStatusEnum\s*=\s*pgEnum\([\s\S]*?\[([\s\S]*?)\]/
  );
  assert.ok(m, "未找到 importTaskStatusEnum 定义");
  assert.match(m[1], /"partial_success"/, "枚举中缺少 partial_success");
  // 必须包含考试要求的基础状态
  for (const s of ["pending", "processing", "completed", "failed"]) {
    assert.match(m[1], new RegExp(`"${s}"`), `枚举缺少 ${s}`);
  }
});

test("shard_status 枚举包含 pending / locked / completed / failed", () => {
  const m = src.match(
    /shardStatusEnum\s*=\s*pgEnum\([\s\S]*?\[([\s\S]*?)\]/
  );
  assert.ok(m, "未找到 shardStatusEnum 定义");
  for (const s of ["pending", "locked", "completed", "failed"]) {
    assert.match(m[1], new RegExp(`"${s}"`), `分片枚举缺少 ${s}`);
  }
});

test("outbox_status 枚举包含 pending / sent / failed", () => {
  const m = src.match(
    /outboxStatusEnum\s*=\s*pgEnum\([\s\S]*?\[([\s\S]*?)\]/
  );
  assert.ok(m, "未找到 outboxStatusEnum 定义");
  for (const s of ["pending", "sent", "failed"]) {
    assert.match(m[1], new RegExp(`"${s}"`), `Outbox 枚举缺少 ${s}`);
  }
});

test("import_task_errors 表包含 errorCode 列（行级错误表）", () => {
  const block = src.match(/importTaskErrors\s*=\s*pgTable\([\s\S]*?\);/);
  assert.ok(block, "未找到 importTaskErrors 定义");
  assert.match(block[0], /errorCode/, "缺少 errorCode 列");
  assert.match(block[0], /errorReason/, "缺少 errorReason 列");
  assert.match(block[0], /rowNumber/, "缺少 rowNumber 列（行级定位）");
});

test("trace_events 表存在（Trace 检索）", () => {
  const block = src.match(/traceEvents\s*=\s*pgTable\([\s\S]*?\);/);
  assert.ok(block, "未找到 traceEvents 定义");
  assert.match(block[0], /eventName/, "缺少 eventName 列");
  assert.match(block[0], /occurredAt/, "缺少 occurredAt 列");
});

test("batch_performance_log 表存在（监控）", () => {
  const block = src.match(/batchPerformanceLog\s*=\s*pgTable\([\s\S]*?\);/);
  assert.ok(block, "未找到 batchPerformanceLog 定义");
  for (const col of ["parseDurationMs", "validateDurationMs", "insertDurationMs", "totalDurationMs"]) {
    assert.match(block[0], new RegExp(col), `缺少 ${col} 列`);
  }
});

test("event_outbox 表存在（Transactional Outbox）", () => {
  const block = src.match(/eventOutbox\s*=\s*pgTable\([\s\S]*?\);/);
  assert.ok(block, "未找到 eventOutbox 定义");
  for (const col of ["eventType", "payload", "status", "retryCount"]) {
    assert.match(block[0], new RegExp(col), `缺少 ${col} 列`);
  }
});

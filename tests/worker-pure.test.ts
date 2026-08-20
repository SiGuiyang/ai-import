/**
 * Worker 纯函数单测：
 * - 最终状态判定（partial_success）
 * - 错误码映射（E001-E008 体系）
 * - 卡死恢复决策
 * - 批量分片策略
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFinalStatus,
  mapFormatErrorToCode,
  SKU_NOT_FOUND_CODE,
  decideRecoveryAction,
  batchSlices,
  findInvalidSkus,
} from "../src/lib/worker/pure";

test("resolveFinalStatus: 无失败行 → completed", () => {
  assert.equal(resolveFinalStatus(0), "completed");
});

test("resolveFinalStatus: 有失败行 → partial_success（考试要求）", () => {
  assert.equal(resolveFinalStatus(1), "partial_success");
  assert.equal(resolveFinalStatus(99), "partial_success");
});

test("mapFormatErrorToCode: 必填缺失 → E002", () => {
  assert.equal(mapFormatErrorToCode("storeName"), "E002");
  assert.equal(mapFormatErrorToCode("items[0].skuCode"), "E002");
});

test("mapFormatErrorToCode: 电话格式 → E003", () => {
  assert.equal(mapFormatErrorToCode("receiverPhone"), "E003");
});

test("mapFormatErrorToCode: 数量非正 → E004", () => {
  assert.equal(mapFormatErrorToCode("items[1].quantity"), "E004");
});

test("mapFormatErrorToCode: 外部编码重复 → E005", () => {
  assert.equal(mapFormatErrorToCode("externalCode"), "E005");
});

test("SKU 主数据不存在错误码统一为 E001（禁止自定义 SKU_NOT_FOUND）", () => {
  assert.equal(SKU_NOT_FOUND_CODE, "E001");
  // 全仓库不应再出现自定义 SKU_NOT_FOUND 错误码定义
  const fs = require("node:fs");
  const path = require("node:path");
  const processorSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "worker", "import-processor.ts"),
    "utf-8"
  );
  assert.ok(
    !/SKU_NOT_FOUND/.test(processorSrc),
    "import-processor.ts 中不应存在 SKU_NOT_FOUND 自定义码"
  );
});

test("decideRecoveryAction: retryCount 未达上限 → 重投", () => {
  assert.equal(decideRecoveryAction(0), "re-enqueue");
  assert.equal(decideRecoveryAction(1), "re-enqueue");
  assert.equal(decideRecoveryAction(2), "re-enqueue");
});

test("decideRecoveryAction: retryCount 达上限 → 标记失败", () => {
  assert.equal(decideRecoveryAction(3), "mark-failed");
  assert.equal(decideRecoveryAction(5), "mark-failed");
});

test("batchSlices: 按指定大小切分批量（批量写入，禁止逐行）", () => {
  const items = Array.from({ length: 450 }, (_, i) => i);
  const batches = batchSlices(items, 200);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].length, 200);
  assert.equal(batches[1].length, 200);
  assert.equal(batches[2].length, 50);
});

test("findInvalidSkus: 仅返回不存在于主数据的 SKU", () => {
  const valid = new Set(["SKU_00001", "SKU_00002"]);
  assert.deepEqual(findInvalidSkus(["SKU_00001", "SKU_99999"], valid), [
    "SKU_99999",
  ]);
  assert.deepEqual(findInvalidSkus(["SKU_00001"], valid), []);
});

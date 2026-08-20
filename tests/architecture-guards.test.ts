/**
 * 架构红线守卫测试（静态源码检查）：
 * - 批量写入（禁止逐行 INSERT）
 * - 上传接口：任务 + 分片 + Outbox 同一 DB 事务
 * - Outbox 可靠投递（dispatcher）
 * - 幂等：分片已 completed 快速返回
 * - 监控真实百分位（PERCENTILE_CONT，禁止 avg*系数伪造）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function read(name: string): string {
  return readFileSync(join(__dirname, "..", "src", ...name.split("/")), "utf-8");
}

const processor = read("lib/worker/import-processor.ts");
const uploadRoute = read("app/api/import-tasks/route.ts");
const summaryRoute = read("app/api/import-monitor/summary/route.ts");
const workerIndex = read("lib/worker/index.ts");
const dispatcher = read("lib/outbox/dispatcher.ts");

test("[红线] 写入订单使用批量 values()，而非逐行 INSERT", () => {
  // 批量插入 orders：values(batch.map(...)) 或 values(batch)
  assert.match(
    processor,
    /insert\(orders\)\s*\.values\(batch/,
    "orders 写入必须是批量 values(batch)"
  );
  // orderItems 同样批量
  assert.match(
    processor,
    /insert\(orderItems\)\s*\.values\(itemValues/,
    "orderItems 写入必须是批量 values(itemValues)"
  );
  // 禁止在 for 循环体内逐行插入 orders（批量特征为 .values(batch.map(...))）
  const singleObjInsert = processor.match(
    /for\s*\([\s\S]{0,120}?\)\s*\{[\s\S]{0,300}?insert\(orders\)\.values\(\{/
  );
  assert.ok(!singleObjInsert, "检测到循环内单对象 INSERT orders");
  const singleArrInsert = processor.match(
    /for\s*\([\s\S]{0,120}?\)\s*\{[\s\S]{0,300}?insert\(orders\)\.values\(\[/
  );
  assert.ok(!singleArrInsert, "检测到循环内单元素数组 INSERT orders");
});

test("[红线] 上传接口使用 db.transaction 同事务写入 任务+分片+Outbox", () => {
  const txStart = uploadRoute.indexOf("db.transaction(async (tx) => {");
  assert.ok(txStart >= 0, "缺少 db.transaction");
  const outboxIdx = uploadRoute.indexOf(
    "tx.insert(eventOutbox).values(outboxValues as any);"
  );
  assert.ok(outboxIdx > txStart, "事务内缺少 Outbox 事件写入");
  const txBlock = uploadRoute.slice(txStart, outboxIdx);
  assert.match(txBlock, /insert\(importTasks\)/, "事务内缺少任务写入");
  assert.match(txBlock, /insert\(importTaskShards\)/, "事务内缺少分片写入");
});

test("[红线] Outbox dispatcher 存在且按事件名分发", () => {
  assert.ok(dispatcher.length > 0, "dispatcher.ts 为空");
  assert.match(dispatcher, /eventOutbox/, "dispatcher 引用 eventOutbox");
});

test("[红线] 数据库驱动必须支持事务（neon-serverless，禁止 neon-http）", () => {
  const dbIndex = read("lib/db/index.ts");
  assert.match(dbIndex, /neon-serverless/, "必须使用 drizzle-orm/neon-serverless");
  assert.match(dbIndex, /Pool/, "必须使用 @neondatabase/serverless Pool");
  assert.ok(!/neon-http/.test(dbIndex), "禁止使用 drizzle-orm/neon-http（不支持事务）");
});

test("[幂等] 分片已 completed 时快速返回", () => {
  assert.match(
    processor,
    /status\s*===\s*"completed"[\s\S]{0,300}?already completed, skip/,
    "缺少分片已完成的幂等快速返回"
  );
  assert.match(processor, /SHARD_SKIPPED/, "缺少 SHARD_SKIPPED Trace 事件");
});

test("[幂等] pending → locked 原子更新（条件 status=pending）", () => {
  const lockBlock = processor.match(/status: "locked"[\s\S]{0,600}?status\} = 'pending'/);
  assert.ok(lockBlock, "锁定更新必须带 pending 条件（原子）");
});

test("[监控] 后端使用 PERCENTILE_CONT 计算真实百分位（禁止 avg 伪造）", () => {
  assert.match(summaryRoute, /PERCENTILE_CONT/, "缺少 PERCENTILE_CONT");
  assert.match(summaryRoute, /P50/, "缺少 P50");
  assert.match(summaryRoute, /P95/, "缺少 P95");
  assert.match(summaryRoute, /P99/, "缺少 P99");
  // 前端不得再用 avg*0.3 / avg*3 伪造
  const monitorPage = read("app/monitor/page.tsx");
  assert.ok(
    !/avg\s*\*\s*0\.3|avg\s*\*\s*3/.test(monitorPage),
    "前端仍存在 avg 系数伪造百分位"
  );
});

test("[恢复] Worker 具备卡死分片恢复（locked 超时扫描）", () => {
  assert.match(workerIndex, /recoverStuckShards/, "缺少 recoverStuckShards");
  assert.match(workerIndex, /status, "locked"/, "恢复逻辑未扫描 locked 分片");
  assert.match(workerIndex, /lockedAt\}\s*</, "恢复逻辑未按锁定时间判断");
  assert.match(workerIndex, /decideRecoveryAction/, "恢复决策未使用 decideRecoveryAction");
});

test("[错误码] 处理器使用 E001-E008 体系，无自定义 SKU_NOT_FOUND", () => {
  assert.match(processor, /errorCode: "E001"/, "缺少 E001（SKU 不存在）");
  assert.match(processor, /errorCode: "E007"/, "缺少 E007（写入失败）");
  // E002-E005 收敛到 mapFormatErrorToCode（纯函数，见 worker-pure 单测）
  assert.match(processor, /mapFormatErrorToCode/, "缺少格式错误码映射函数");
  assert.match(processor, /errorCode: "SKIP_VALIDATION"/, "缺少降级 SKIP_VALIDATION 记录");
  assert.ok(!/SKU_NOT_FOUND/.test(processor), "存在自定义 SKU_NOT_FOUND 码");
  const pure = read("lib/worker/pure.ts");
  assert.match(pure, /return "E002"/, "E002 必填缺失映射缺失");
  assert.match(pure, /return "E003"/, "E003 电话格式映射缺失");
  assert.match(pure, /return "E004"/, "E004 数量映射缺失");
  assert.match(pure, /return "E005"/, "E005 重复编码映射缺失");
});

test("[降级] SKU 校验超时降级路径存在（Promise.race + 3s 超时）", () => {
  assert.match(processor, /Promise\.race/, "缺少 Promise.race 超时实现");
  assert.match(processor, /SKU_QUERY_TIMEOUT/, "缺少 SKU 查询超时常量");
  assert.match(processor, /SKU_VALIDATION_DEGRADED/, "缺少降级 Trace 事件");
  assert.match(processor, /SKIP_VALIDATION/, "缺少降级时 SKIP_VALIDATION 错误记录");
});

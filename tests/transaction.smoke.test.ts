/**
 * 集成测试：验证 neon-serverless（WebSocket）驱动下 db.transaction 真实可用
 * - 场景1：事务内抛错 → 回滚，数据不应存在
 * - 场景2：事务正常完成 → 提交，数据应可见
 *
 * 运行方式：npm run test:tx（需要 DATABASE_URL；缺失时自动跳过）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { db, closeDb } from "../src/lib/db";
import { skuMaster } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const hasDb = Boolean(process.env.DATABASE_URL);
const CODE = `TX_SMOKE_${Date.now()}`;

test(
  "db.transaction 支持回滚（neon-serverless 驱动）",
  { skip: !hasDb ? "DATABASE_URL 未配置，跳过真实事务测试" : false },
  async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(skuMaster).values({ skuCode: CODE, name: "tx-smoke" });
        throw new Error("force-rollback");
      });
      assert.fail("事务未按预期回滚");
    } catch (e: any) {
      assert.equal(e.message, "force-rollback");
    }
    const [row] = await db
      .select()
      .from(skuMaster)
      .where(eq(skuMaster.skuCode, CODE));
    assert.equal(row, undefined, "回滚后数据不应存在");
  }
);

test(
  "db.transaction 支持提交（neon-serverless 驱动）",
  { skip: !hasDb ? "DATABASE_URL 未配置，跳过真实事务测试" : false },
  async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(skuMaster).values({ skuCode: CODE, name: "tx-smoke" });
      });
      const [row] = await db
        .select()
        .from(skuMaster)
        .where(eq(skuMaster.skuCode, CODE));
      assert.ok(row, "事务提交后数据应可见");
    } finally {
      await db.delete(skuMaster).where(eq(skuMaster.skuCode, CODE));
      await closeDb();
    }
  }
);

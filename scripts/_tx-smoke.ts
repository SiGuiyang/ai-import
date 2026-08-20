/**
 * 临时冒烟脚本：验证 neon-serverless 驱动下 db.transaction 真实可用
 * 场景1：事务内回滚（插入后抛错 → 数据不应存在）
 * 场景2：事务内提交（插入 → 事务外应可见 → 清理）
 */
import { db, closeDb } from "../src/lib/db";
import { skuMaster } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

const CODE = "TX_SMOKE_" + Date.now();

async function main() {
  // 场景1：回滚
  try {
    await db.transaction(async (tx) => {
      await tx.insert(skuMaster).values({ skuCode: CODE, name: "tx-smoke" });
      throw new Error("force-rollback");
    });
    console.log("FAIL: 事务未回滚");
    process.exit(1);
  } catch (e: any) {
    if (e.message !== "force-rollback") throw e;
    const [row] = await db.select().from(skuMaster).where(eq(skuMaster.skuCode, CODE));
    if (row) {
      console.log("FAIL: 回滚后数据仍存在");
      process.exit(1);
    }
    console.log("PASS: 事务回滚生效");
  }

  // 场景2：提交
  await db.transaction(async (tx) => {
    await tx.insert(skuMaster).values({ skuCode: CODE, name: "tx-smoke" });
  });
  const [row] = await db.select().from(skuMaster).where(eq(skuMaster.skuCode, CODE));
  if (!row) {
    console.log("FAIL: 事务提交后数据不可见");
    process.exit(1);
  }
  console.log("PASS: 事务提交生效");

  // 清理
  await db.delete(skuMaster).where(eq(skuMaster.skuCode, CODE));
  console.log("PASS: 全部通过，neon-serverless 驱动事务可用");
  await closeDb();
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});

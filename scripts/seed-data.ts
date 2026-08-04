/**
 * 种子数据生成脚本
 *
 * 使用方式：
 *   npx tsx scripts/seed-data.ts
 *
 * 功能：
 * 1. 清理旧的测试数据（可选）
 * 2. 插入 20,000 条 SKU 主数据
 * 3. 生成 10,000 行压测 Excel 文件
 * 4. 混入约 5% 非法 SKU 校验降级和错误统计
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../src/lib/db/schema";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const EXCEL_OUTPUT_PATH = path.join(__dirname, "..", "test-data-10000.xlsx");
const SKU_COUNT = 20000;
const EXCEL_ROWS = 10000;
const INVALID_SKU_RATIO = 0.05; // 5% 非法 SKU
const BATCH_INSERT_SIZE = 1000;

async function main() {
  console.log("=".repeat(60));
  console.log("V4 Seed Data Generator");
  console.log(`  SKUs: ${SKU_COUNT}`);
  console.log(`  Excel rows: ${EXCEL_ROWS}`);
  console.log("=".repeat(60));

  // 连接数据库
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const sql = neon(dbUrl);
  const db = drizzle(sql, { schema });

  // ========== Step 1: 清理旧数据 ==========
  console.log("\n[1/3] Cleaning old data...");
  try {
    await db.delete(schema.skuMaster);
    console.log("  sku_master: cleared");
  } catch (e: any) {
    console.log("  sku_master: skip (table may not exist yet)");
  }

  // ========== Step 2: 插入 SKU 主数据 ==========
  console.log(`\n[2/3] Inserting ${SKU_COUNT} SKU records...`);

  const skuValues: any[] = [];
  const categories = ["电子产品", "日用品", "食品", "服装", "办公用品"];
  const units = ["个", "箱", "件", "套", "包"];

  for (let i = 1; i <= SKU_COUNT; i++) {
    const code = `SKU_${String(i).padStart(5, "0")}`;
    const catIdx = i % categories.length;
    skuValues.push({
      skuCode: code,
      name: `${categories[catIdx]}-${code} ${i % 10 === 0 ? " (畅销)" : ""}`,
      spec: `${Math.floor(Math.random() * 500 + 10)}g / ${Math.floor(Math.random() * 30 + 1)}cm`,
      unit: units[i % units.length],
    });
  }

  // 批量插入
  let inserted = 0;
  for (let i = 0; i < skuValues.length; i += BATCH_INSERT_SIZE) {
    const batch = skuValues.slice(i, i + BATCH_INSERT_SIZE);
    await db.insert(schema.skuMaster).values(batch as any);
    inserted += batch.length;
    if (inserted % 5000 === 0) {
      console.log(`  Inserted: ${inserted}/${SKU_COUNT}`);
    }
  }
  console.log(`  Done: ${inserted} SKUs inserted`);

  // ========== Step 3: 生成 Excel 文件 ==========
  console.log(`\n[3/3] Generating ${EXCEL_ROWS} row Excel...`);

  const storeNames = ["北京朝阳旗舰店", "上海浦东店", "广州天河店", "深圳南山店", "杭州西湖店"];
  const receivers = ["张三", "李四", "王五", "赵六", "钱七"];
  const phones = ["13800138001", "13800138002", "13800138003"];

  const rows: any[][] = [];
  // 表头
  rows.push([
    "外部单号",
    "门店名称",
    "收件人",
    "收件人电话",
    "收件人地址",
    "SKU编码",
    "SKU名称",
    "数量",
    "规格",
    "备注",
  ]);

  for (let i = 1; i <= EXCEL_ROWS; i++) {
    const orderNo = `EX-${String(i).padStart(6, "0")}`;
    const store = storeNames[i % storeNames.length];
    const receiver = receivers[i % receivers.length];
    const phone = phones[i % phones.length];
    const address = `${store} 详细地址 ${i}`;

    // 每行 1-3 个 SKU
    const itemCount = (i % 3) + 1;
    for (let j = 0; j < itemCount; j++) {
      const isInvalid = Math.random() < INVALID_SKU_RATIO;
      const skuIndex = i * itemCount + j;
      const skuCode = isInvalid
        ? `INVALID_SKU_${Math.floor(Math.random() * 1000)}`
        : `SKU_${String((skuIndex % SKU_COUNT) + 1).padStart(5, "0")}`;

      const skuName = isInvalid ? "非法商品" : `${categories[skuIndex % categories.length]}-${skuCode}`;
      const quantity = Math.floor(Math.random() * 100) + 1;
      const spec = isInvalid ? "未知" : `${Math.floor(Math.random() * 500 + 10)}g`;
      const remark = i === 1 && j === 0 ? "第一行数据" : "";

      rows.push([
        orderNo,
        store,
        receiver,
        phone,
        address,
        skuCode,
        skuName,
        quantity,
        spec,
        remark,
      ]);
    }
  }

  // 写入 Excel
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  // 设置列宽
  worksheet["!cols"] = [
    { wch: 15 },
    { wch: 18 },
    { wch: 10 },
    { wch: 15 },
    { wch: 25 },
    { wch: 18 },
    { wch: 20 },
    { wch: 8 },
    { wch: 12 },
    { wch: 15 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, worksheet, "Sheet1");

  XLSX.writeFile(wb, EXCEL_OUTPUT_PATH);
  const actualRows = rows.length - 1; // 减去表头
  console.log(`  Done: ${actualRows} data rows written to ${EXCEL_OUTPUT_PATH}`);

  // 统计
  const invalidCount = rows.filter(
    (r) => r[5] && r[5].toString().startsWith("INVALID")
  ).length;
  console.log(`  Invalid SKU count: ~${invalidCount} (${((invalidCount / actualRows) * 100).toFixed(1)}%)`);

  console.log("\n" + "=".repeat(60));
  console.log("Seed data generation complete!");
  console.log(`  SKUs: ${SKU_COUNT}`);
  console.log(`  Excel: ${EXCEL_OUTPUT_PATH} (${actualRows} rows)`);
  console.log("=".repeat(60));

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

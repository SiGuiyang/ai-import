/**
 * 上传快速计数测试：
 * 上传接口用 XLSX decode_range 快速读取行数（不逐单元格解析），
 * 保证 10,000 行文件上传 P95 ≤ 1s。
 *
 * 本测试验证：decode_range 得到的行数与全量 aoa 行数一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

function buildWorkbook(rows: number): XLSX.WorkBook {
  const header = ["外部单号", "门店名称", "收件人", "收件人电话", "SKU编码", "数量"];
  const data: any[][] = [header];
  for (let i = 1; i <= rows; i++) {
    data.push([
      `EX-${String(i).padStart(6, "0")}`,
      "北京朝阳旗舰店",
      "张三",
      "13800138001",
      `SKU_${String((i % 20000) + 1).padStart(5, "0")}`,
      (i % 100) + 1,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

test("decode_range 快速计数与全量数据行数一致（10,000 行）", () => {
  const wb = buildWorkbook(10000);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws["!ref"] as string;
  const range = XLSX.utils.decode_range(ref);
  const dataRows = range.e.r - range.s.r; // 减表头
  assert.equal(dataRows, 10000);
});

test("decode_range 计数远快于全量解析（性能敏感性冒烟）", () => {
  const wb = buildWorkbook(10000);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ref = ws["!ref"] as string;

  const t0 = performance.now();
  const range = XLSX.utils.decode_range(ref);
  const fastMs = performance.now() - t0;

  const t1 = performance.now();
  const all = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  const fullMs = performance.now() - t1;

  assert.equal(range.e.r - range.s.r, all.length - 1);
  assert.ok(
    fastMs < fullMs,
    `快速计数应快于全量解析（fast=${fastMs.toFixed(2)}ms, full=${fullMs.toFixed(2)}ms）`
  );
});

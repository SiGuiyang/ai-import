/**
 * 校验器单测（考试要求：必填 / 电话格式 / 数量正数 / 外部编码重复）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOrders } from "../src/lib/validation/validator";
import type { ParsedOrder } from "../src/lib/parser/types";

function makeOrder(overrides: Partial<ParsedOrder> = {}): ParsedOrder {
  return {
    externalCode: "EX-000001",
    storeName: "北京朝阳旗舰店",
    receiverName: "张三",
    receiverPhone: "13800138001",
    receiverAddress: "北京市朝阳区某地",
    remark: "",
    items: [
      { skuCode: "SKU_00001", skuName: "商品A", quantity: 2, specification: "" },
    ],
    ...overrides,
  } as ParsedOrder;
}

test("合法订单：无错误", () => {
  const errors = validateOrders([makeOrder()]);
  assert.equal(errors.length, 0);
});

test("A组（门店）和B组（收件人）至少填一组 → 缺一组报错", () => {
  const order = makeOrder({ storeName: "", receiverName: "", receiverPhone: "", receiverAddress: "" });
  const errors = validateOrders([order]);
  assert.ok(errors.some((e) => e.field === "storeName"));
});

test("电话格式错误 → 报错", () => {
  const order = makeOrder({ receiverPhone: "12345" });
  const errors = validateOrders([order]);
  assert.ok(errors.some((e) => e.field === "receiverPhone"));
});

test("数量非正数 → 报错", () => {
  const order = makeOrder({ items: [{ skuCode: "SKU_00001", skuName: "商品A", quantity: 0, specification: "" }] });
  const errors = validateOrders([order]);
  assert.ok(errors.some((e) => e.field.endsWith("].quantity")));
});

test("SKU 编码为空 → 报错", () => {
  const order = makeOrder({ items: [{ skuCode: "", skuName: "商品A", quantity: 1, specification: "" }] });
  const errors = validateOrders([order]);
  assert.ok(errors.some((e) => e.field.endsWith("].skuCode")));
});

test("同批次外部编码重复 → 报错（E005 场景）", () => {
  const a = makeOrder({ externalCode: "DUP-1" });
  const b = makeOrder({ externalCode: "DUP-1" });
  const c = makeOrder({ externalCode: "UNIQUE" });
  const errors = validateOrders([a, b, c]);
  const dupErrors = errors.filter((e) => e.field === "externalCode");
  assert.equal(dupErrors.length, 2); // 两行重复都报
});

test("批量校验：多行错误全部收集（不中断）", () => {
  const bad1 = makeOrder({ receiverPhone: "abc", externalCode: "X-1" });
  const bad2 = makeOrder({ externalCode: "X-1" }); // 与 bad1 重复编码
  const bad3 = makeOrder({ storeName: "", receiverName: "", receiverPhone: "", receiverAddress: "" });
  const errors = validateOrders([bad1, bad2, bad3]);
  // bad1: 电话错误 + 重复编码；bad2: 重复编码；bad3: AB组缺失 → 至少 4 条
  assert.ok(errors.length >= 4, `实际收集 ${errors.length} 条`);
});

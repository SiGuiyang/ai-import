import type { ParsedOrder } from "../parser/types";

export interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  orderId?: string;
}

export function validateOrders(orders: ParsedOrder[]): ValidationError[] {
  const errors: ValidationError[] = [];

  orders.forEach((order, idx) => {
    // A/B组校验：至少填一组
    const hasGroupA = !!order.storeName;
    const hasGroupB = !!(
      order.receiverName &&
      order.receiverPhone &&
      order.receiverAddress
    );

    if (!hasGroupA && !hasGroupB) {
      errors.push({
        rowIndex: idx,
        field: "storeName",
        message: "A组（门店）和B组（收件人）至少填一组",
      });
    }

    // 电话格式校验
    if (order.receiverPhone && !/^1[3-9]\d{9}$/.test(order.receiverPhone)) {
      errors.push({
        rowIndex: idx,
        field: "receiverPhone",
        message: "收件人电话格式错误",
      });
    }

    // SKU 校验
    order.items.forEach((item, itemIdx) => {
      if (!item.skuCode || String(item.skuCode).trim() === "") {
        errors.push({
          rowIndex: idx,
          field: `items[${itemIdx}].skuCode`,
          message: "SKU编码不能为空",
        });
      }
      if (!item.skuName || String(item.skuName).trim() === "") {
        errors.push({
          rowIndex: idx,
          field: `items[${itemIdx}].skuName`,
          message: "SKU名称不能为空",
        });
      }
      if (!item.quantity || Number(item.quantity) <= 0) {
        errors.push({
          rowIndex: idx,
          field: `items[${itemIdx}].quantity`,
          message: "发货数量必须为正数",
        });
      }
    });
  });

  // 外部编码重复检测（同批次内）
  const codeMap = new Map<string, number[]>();
  orders.forEach((order, idx) => {
    if (order.externalCode) {
      if (!codeMap.has(order.externalCode)) {
        codeMap.set(order.externalCode, []);
      }
      codeMap.get(order.externalCode)!.push(idx);
    }
  });

  codeMap.forEach((indices, code) => {
    if (indices.length > 1) {
      indices.forEach((idx) => {
        errors.push({
          rowIndex: idx,
          field: "externalCode",
          message: `外部编码"${code}"与第${indices[0] + 1}行重复`,
        });
      });
    }
  });

  return errors;
}

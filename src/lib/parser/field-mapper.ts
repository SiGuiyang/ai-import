import type { ParsedOrder, ParsedOrderItem, FieldMapping, FieldSource } from "./types";

export function applyFieldMapping(
  intermediateData: Record<string, any>[],
  fieldMapping: FieldMapping,
  groupField?: string
): ParsedOrder[] {
  if (!intermediateData || intermediateData.length === 0) return [];

  const getValue = (record: Record<string, any>, source?: FieldSource): any => {
    if (!source) return undefined;
    // 支持嵌套字段路径，如 "items[0].skuCode"
    const parts = source.fieldPath.split(".");
    let val: any = record;
    for (const part of parts) {
      if (val == null) return null;
      // 处理数组索引，如 items[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        val = val[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
      } else {
        val = val[part];
      }
    }
    return val;
  };

  const applyTransform = (value: any, transform?: string): any => {
    if (!transform) return value;
    switch (transform) {
      case "toString":
        return String(value);
      case "toNumber":
        return Number(value);
      case "toInt":
        return parseInt(String(value), 10);
      case "trim":
        return String(value).trim();
      default:
        return value;
    }
  };

  // 按外部编码或指定字段分组
  const groups: Map<string, Record<string, any>[]> = new Map();

  if (groupField) {
    for (const record of intermediateData) {
      const key = String(record[groupField] ?? "__no_group__");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(record);
    }
  } else if (fieldMapping.externalCode) {
    for (const record of intermediateData) {
      const key = String(
        getValue(record, fieldMapping.externalCode) ?? "__no_group__"
      );
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(record);
    }
  } else {
    groups.set("__default__", intermediateData);
  }

  const orders: ParsedOrder[] = [];

  for (const [groupKey, groupRecords] of groups) {
    const firstRecord = groupRecords[0];

    // 提取收件人/门店信息（从第一行取共享信息）
    const externalCode = groupKey === "__no_group__" || groupKey === "__default__"
      ? undefined
      : groupKey;

    const order: ParsedOrder = {
      externalCode,
      storeName: applyTransform(getValue(firstRecord, fieldMapping.storeName), fieldMapping.storeName?.transform),
      receiverName: applyTransform(getValue(firstRecord, fieldMapping.receiverName), fieldMapping.receiverName?.transform),
      receiverPhone: applyTransform(getValue(firstRecord, fieldMapping.receiverPhone), fieldMapping.receiverPhone?.transform),
      receiverAddress: applyTransform(getValue(firstRecord, fieldMapping.receiverAddress), fieldMapping.receiverAddress?.transform),
      remark: applyTransform(getValue(firstRecord, fieldMapping.remark), fieldMapping.remark?.transform),
      items: groupRecords.map((record, idx): ParsedOrderItem => ({
        skuCode: applyTransform(
          getValue(record, fieldMapping.skuCode),
          fieldMapping.skuCode?.transform
        ) || "",
        skuName: applyTransform(
          getValue(record, fieldMapping.skuName),
          fieldMapping.skuName?.transform
        ) || "",
        quantity: Number(
          applyTransform(
            getValue(record, fieldMapping.quantity),
            fieldMapping.quantity?.transform
          ) || 0
        ),
        specification: applyTransform(
          getValue(record, fieldMapping.specification),
          fieldMapping.specification?.transform
        ),
        sortOrder: idx,
      })),
    };

    orders.push(order);
  }

  return orders;
}

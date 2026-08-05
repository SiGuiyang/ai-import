import type { ParsedOrder, ParsedOrderItem, FieldMapping, FieldSource } from "./types";

export function applyFieldMapping(
  intermediateData: Record<string, any>[],
  fieldMapping: FieldMapping,
  groupField?: string
): ParsedOrder[] {
  if (!intermediateData || intermediateData.length === 0) return [];

  const getValue = (record: Record<string, any>, source?: FieldSource, fallbackKey?: string): any => {
    if (!source) return undefined;
    // 支持嵌套字段路径，如 "items[0].skuCode"
    const parts = source.fieldPath.split(".");
    let val: any = record;
    for (const part of parts) {
      if (val == null) break;
      // 处理数组索引，如 items[0]
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        val = val[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
      } else {
        val = val[part];
      }
    }

    // 如果 fieldPath 找不到值，尝试用 mapping key 作为记录 key 回退
    // 处理列映射已转换为目标字段名但 fieldPath 仍为原始列名的情况
    if (val == null && fallbackKey && fallbackKey !== source.fieldPath) {
      val = record[fallbackKey];
    }

    return val ?? null;
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

  // 辅助：从记录中取值，fieldPath 找不到时用 mappingKey 作为记录 key 回退
  const getField = (record: Record<string, any>, key: keyof FieldMapping) => {
    return getValue(record, fieldMapping[key], key);
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
        getField(record, "externalCode") ?? "__no_group__"
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
      storeName: applyTransform(getField(firstRecord, "storeName"), fieldMapping.storeName?.transform),
      receiverName: applyTransform(getField(firstRecord, "receiverName"), fieldMapping.receiverName?.transform),
      receiverPhone: applyTransform(getField(firstRecord, "receiverPhone"), fieldMapping.receiverPhone?.transform),
      receiverAddress: applyTransform(getField(firstRecord, "receiverAddress"), fieldMapping.receiverAddress?.transform),
      remark: applyTransform(getField(firstRecord, "remark"), fieldMapping.remark?.transform),
      items: groupRecords.map((record, idx): ParsedOrderItem => ({
        skuCode: applyTransform(
          getField(record, "skuCode"),
          fieldMapping.skuCode?.transform
        ) || "",
        skuName: applyTransform(
          getField(record, "skuName"),
          fieldMapping.skuName?.transform
        ) || "",
        quantity: Number(
          applyTransform(
            getField(record, "quantity"),
            fieldMapping.quantity?.transform
          ) || 0
        ),
        specification: applyTransform(
          getField(record, "specification"),
          fieldMapping.specification?.transform
        ),
        sortOrder: idx,
      })),
    };

    orders.push(order);
  }

  return orders;
}

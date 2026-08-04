import type { Extractor } from "./index";

export class GroupByExtractor implements Extractor {
  type = "group-by";

  extract(sheet: any, config: Record<string, any>): Record<string, any>[] {
    // group-by 接受前一步骤的输出数据
    const { inputData = [], groupField, aggregateFields = [], sharedFields = [] } = config;

    if (!Array.isArray(inputData) || inputData.length === 0) {
      return [];
    }

    // 按 groupField 分组
    const groups = new Map<string, Record<string, any>[]>();

    for (const record of inputData) {
      const groupKey = String(record[groupField] ?? "__no_group__");
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(record);
    }

    const results: Record<string, any>[] = [];

    groups.forEach((groupRecords, groupKey) => {
      const merged: Record<string, any> = {
        [groupField]: groupKey === "__no_group__" ? null : groupKey,
      };

      // 共享字段：取第一行的值
      const firstRecord = groupRecords[0];
      for (const field of sharedFields) {
        merged[field] = firstRecord[field];
      }

      // 聚合字段：收集为数组
      if (aggregateFields.length > 0) {
        for (const field of aggregateFields) {
          merged[field] = groupRecords.map((r) => r[field]).filter((v) => v != null);
        }
      }

      // 如果没有聚合字段，则将组内记录作为一个整体输出
      // 每个 item 记录保留在 items_ 前缀中
      merged._groupItems = groupRecords;
      merged._groupCount = groupRecords.length;

      results.push(merged);
    });

    return results;
  }
}

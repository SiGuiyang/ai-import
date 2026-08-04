import type { Extractor } from "./index";
import type { UnifiedSheet } from "../types";

export class CellSplitExtractor implements Extractor {
  type = "cell-split";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    // cell-split 通常作为 pipeline 中的一步，由上一个 step 的结果
    // 被其他提取器（如 matrix-transpose）内部调用
    // 这里提供一个独立的实现，用于处理已经生成的中间数据
    const { inputData = [], splitField, splitBy, subFields = [] } = config;

    if (!Array.isArray(inputData) || inputData.length === 0) {
      return [];
    }

    const results: Record<string, any>[] = [];

    for (const record of inputData) {
      const valueToSplit = record[splitField];
      if (valueToSplit == null || String(valueToSplit).trim() === "") {
        results.push(record);
        continue;
      }

      const parts = String(valueToSplit).split(splitBy);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (subFields.length === 1) {
          results.push({ ...record, [subFields[0].name]: trimmed });
        } else if (subFields.length > 1) {
          const subParts = trimmed.split(/\s+/);
          const subRecord = { ...record };
          for (let i = 0; i < subFields.length; i++) {
            subRecord[subFields[i].name] = subParts[i]?.trim() ?? null;
          }
          results.push(subRecord);
        }
      }
    }

    return results;
  }
}

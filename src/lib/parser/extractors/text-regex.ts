import type { Extractor } from "./index";
import type { UnifiedSheet } from "../types";

export class TextRegexExtractor implements Extractor {
  type = "text-regex";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    const {
      recordSeparator,
      fieldPatterns = [],
      itemListPattern,
      itemFields = [],
    } = config;

    const rawText = sheet.rawText || "";
    if (!rawText.trim()) return [];

    // 按分隔符拆分记录
    const recordTexts = rawText.split(recordSeparator).filter((t) => t.trim());

    const results: Record<string, any>[] = [];

    for (const recordText of recordTexts) {
      const record: Record<string, any> = {};

      // 提取字段
      for (const fp of fieldPatterns) {
        const flags = fp.multiline ? "s" : "";
        const regex = new RegExp(fp.pattern, flags);
        const match = recordText.match(regex);
        if (match) {
          record[fp.name] = match[fp.group || 1]?.trim() || match[0]?.trim();
        } else {
          record[fp.name] = null;
        }
      }

      // 提取物品列表
      if (itemListPattern && itemFields.length > 0) {
        const itemRegex = new RegExp(itemListPattern, "g");
        const items: Record<string, any>[] = [];
        let match;

        while ((match = itemRegex.exec(recordText)) !== null) {
          const item: Record<string, any> = {};
          for (let i = 0; i < itemFields.length; i++) {
            const val = match[i + 1]?.trim();
            item[itemFields[i]] = val ?? null;
          }
          items.push(item);
        }

        if (items.length > 0) {
          // 对每个 item 创建独立记录
          for (const item of items) {
            results.push({ ...record, ...item });
          }
          continue;
        }
      }

      results.push(record);
    }

    return results;
  }
}

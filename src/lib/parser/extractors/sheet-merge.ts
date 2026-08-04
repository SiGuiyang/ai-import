import type { Extractor } from "./index";
import type { UnifiedSheet } from "../types";
import { executeStep } from "./index";
import type { ParsingStep } from "../types";

export class SheetMergeExtractor implements Extractor {
  type = "sheet-merge";

  extract(): Record<string, any>[] {
    // Note: sheet-merge 是特殊的提取器，它不接受单个 sheet
    // 需要从外部传入所有 sheets
    // 这里做降级处理
    throw new Error("sheet-merge 提取器需要通过解析引擎的 workbook 级别调用");
  }

  /**
   * 遍历所有 Sheet，对每个 Sheet 执行 perSheetSteps
   */
  extractFromSheets(
    sheets: UnifiedSheet[],
    config: Record<string, any>
  ): Record<string, any>[] {
    const {
      sheetNames,
      excludeSheets = [],
      sheetNameAsField,
      perSheetSteps = [],
    } = config;

    const results: Record<string, any>[] = [];

    // 确定要处理的 Sheet
    let targetSheets = sheets;
    if (sheetNames && sheetNames.length > 0) {
      targetSheets = sheets.filter((s) => sheetNames.includes(s.name));
    }

    for (const sheet of targetSheets) {
      if (excludeSheets.includes(sheet.name)) continue;

      // 执行每个 Sheet 内部的步骤
      let sheetResults: Record<string, any>[] = [];

      for (const step of perSheetSteps) {
        const stepObj = step as ParsingStep;
        if (stepObj.enabled === false) continue;
        const stepResult = executeStep(sheet, stepObj);
        sheetResults = [...sheetResults, ...stepResult];
      }

      // 添加 Sheet 名作为字段
      if (sheetNameAsField) {
        sheetResults = sheetResults.map((r) => ({
          ...r,
          [sheetNameAsField]: sheet.name,
        }));
      }

      results.push(...sheetResults);
    }

    return results;
  }
}

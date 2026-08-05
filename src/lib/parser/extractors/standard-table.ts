import type { Extractor } from "./index";
import type { UnifiedSheet, CellValue } from "../types";

export class StandardTableExtractor implements Extractor {
  type = "standard-table";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    const { headerRow, dataStartRow, dataEndRow, skipRows = [], columnMapping = {}, ignoreColumns = [], mergeCellStrategy = "fill-down" } = config;
    const cells = sheet.cells;
    if (!cells || cells.length === 0) return [];

    // 读取表头
    const headerCells = cells[headerRow] || [];
    const headers: string[] = headerCells.map((c: CellValue) => c.value != null ? String(c.value).trim() : "");

    // 构建列索引映射 (原始列名 → 列索引)
    const colIndexMap: Record<string, number> = {};
    headers.forEach((h, idx) => {
      if (h && !ignoreColumns.includes(h)) {
        colIndexMap[h] = idx;
      }
    });

    // 确定数据结束行
    const endRow = dataEndRow ?? cells.length;
    const results: Record<string, any>[] = [];
    const filledValues: Record<number, Record<string, any>> = {};

    for (let r = dataStartRow; r < endRow; r++) {
      if (skipRows.includes(r)) continue;
      const row = cells[r];
      if (!row || row.every((c: CellValue) => c.value == null)) continue;

      const record: Record<string, any> = {};
      let hasData = false;

      // 按 columnMapping 映射字段
      // columnMapping 格式：{ 原始列名: 目标字段名 }，例如 { "编码": "SKU编码" }
      for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
        const colIdx = colIndexMap[String(sourceCol)];
        if (colIdx === undefined) continue;
        const cell = row[colIdx];
        record[targetField as string] = cell?.value ?? null;
        if (cell?.value != null) hasData = true;
      }

      // Fill-down 策略：填充合并单元格的空值
      if (mergeCellStrategy === "fill-down") {
        for (const key of Object.keys(record)) {
          if (record[key] == null && filledValues[r - 1]?.[key] != null) {
            record[key] = filledValues[r - 1][key];
            hasData = true;
          }
        }
      }

      filledValues[r] = { ...record };

      // 如果没有配置 columnMapping，直接按表头名返回
      if (Object.keys(columnMapping).length === 0) {
        for (const [colName, colIdx] of Object.entries(colIndexMap)) {
          const cell = row[colIdx];
          record[colName] = cell?.value ?? null;
          if (cell?.value != null) hasData = true;
        }
      }

      if (hasData) {
        results.push(record);
      }
    }

    return results;
  }
}

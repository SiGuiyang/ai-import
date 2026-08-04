import type { Extractor } from "./index";
import type { UnifiedSheet } from "../types";

export class MatrixTransposeExtractor implements Extractor {
  type = "matrix-transpose";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    const {
      rowHeaderStartCol,
      rowHeaderEndCol,
      rowHeaderNames = [],
      colHeaderRow,
      colHeaderStartCol,
      colHeaderName,
      dataStartRow,
      dataEndRow,
      dataStartCol = colHeaderStartCol,
      cellSplitter,
      cellValuePattern,
      cellFieldNames = [],
    } = config;

    const cells = sheet.cells;
    if (!cells || cells.length === 0) return [];

    // 读取列头（转置轴）
    const colHeaderCells = cells[colHeaderRow] || [];
    const colHeaders: string[] = [];
    for (let c = dataStartCol; c < colHeaderCells.length; c++) {
      const val = colHeaderCells[c]?.value;
      if (val == null || String(val).trim() === "") break;
      colHeaders.push(String(val).trim());
    }

    // 确定数据结束行
    const endRow = dataEndRow ?? cells.length;
    const results: Record<string, any>[] = [];

    for (let r = dataStartRow; r < endRow; r++) {
      const row = cells[r];
      if (!row) continue;

      // 读取行头（固定列）
      const rowHeaders: Record<string, any> = {};
      for (let c = rowHeaderStartCol; c <= rowHeaderEndCol; c++) {
        const headerName = rowHeaderNames[c - rowHeaderStartCol] || `rowHeader${c}`;
        rowHeaders[headerName] = row[c]?.value ?? null;
      }

      // 遍历数据列
      for (let colIdx = 0; colIdx < colHeaders.length; colIdx++) {
        const actualCol = dataStartCol + colIdx;
        const cell = row[actualCol];
        const cellValue = cell?.value;

        if (cellValue == null || String(cellValue).trim() === "") continue;

        const baseRecord: Record<string, any> = {
          ...rowHeaders,
          [colHeaderName]: colHeaders[colIdx],
        };

        // 处理复合单元格（如 "物品名x2\n物品名x2"）
        if (cellSplitter && cellValuePattern && cellFieldNames.length > 0) {
          const parts = String(cellValue).split(cellSplitter);
          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const regex = new RegExp(cellValuePattern);
            const match = trimmed.match(regex);
            if (match) {
              const subRecord: Record<string, any> = { ...baseRecord };
              for (let i = 0; i < cellFieldNames.length; i++) {
                const val = match[i + 1];
                subRecord[cellFieldNames[i]] =
                  cellFieldNames[i]?.toLowerCase().includes("量") ||
                  cellFieldNames[i]?.toLowerCase().includes("数")
                    ? Number(val) || val
                    : val;
              }
              results.push(subRecord);
            } else {
              results.push({ ...baseRecord, value: trimmed });
            }
          }
        } else {
          baseRecord.value = cellValue;
          results.push(baseRecord);
        }
      }
    }

    return results;
  }
}

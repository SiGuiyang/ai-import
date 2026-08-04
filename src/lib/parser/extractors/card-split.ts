import type { Extractor } from "./index";
import type { UnifiedSheet, CellValue } from "../types";

export class CardSplitExtractor implements Extractor {
  type = "card-split";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    const {
      cardMarker,
      innerTableHeaderRowOffset,
      innerTableDataStartOffset,
      innerTableEndMarker,
      cardFields = [],
    } = config;

    const cells = sheet.cells;
    if (!cells || cells.length === 0) return [];

    // 找到所有卡片起始位置
    const cardStartRows: number[] = [];
    for (let r = 0; r < cells.length; r++) {
      const row = cells[r];
      if (!row) continue;
      const firstCellValue = row[0]?.value;
      if (firstCellValue != null && String(firstCellValue).includes(cardMarker)) {
        cardStartRows.push(r);
      }
    }

    const results: Record<string, any>[] = [];

    for (let i = 0; i < cardStartRows.length; i++) {
      const startRow = cardStartRows[i];
      const nextStartRow = i < cardStartRows.length - 1 ? cardStartRows[i + 1] : cells.length;

      // 提取卡片级字段
      const cardRecord: Record<string, any> = {};

      for (const cardField of cardFields) {
        const fieldRow = startRow + cardField.rowOffset;
        const row = cells[fieldRow];
        if (!row) continue;

        if (cardField.prefix) {
          for (const cell of row) {
            if (cell.value != null && String(cell.value).includes(cardField.prefix)) {
              cardRecord[cardField.name] = String(cell.value).replace(cardField.prefix, "").trim();
              break;
            }
          }
        } else if (cardField.pattern) {
          const fullRowText = row.map((c) => (c.value != null ? String(c.value) : "")).join(" ");
          const regex = new RegExp(cardField.pattern);
          const match = fullRowText.match(regex);
          cardRecord[cardField.name] = match ? (match[1] || match[0]) : null;
        }
      }

      // 提取卡片内表格
      const tableHeaderRow = startRow + innerTableHeaderRowOffset;
      const tableDataStartRow = startRow + innerTableDataStartOffset;

      const headerCells = cells[tableHeaderRow] || [];
      const headers = headerCells.map((c: CellValue) =>
        c.value != null ? String(c.value).trim() : ""
      );

      for (let r = tableDataStartRow; r < nextStartRow; r++) {
        if (r >= cells.length) break;

        // 检查是否到达结束标志
        if (innerTableEndMarker) {
          const rowText = cells[r].map((c) => (c.value != null ? String(c.value) : "")).join(" ");
          if (rowText.includes(innerTableEndMarker)) break;
        }

        const row = cells[r];
        if (!row || row.every((c: CellValue) => c.value == null)) continue;

        // 跳过可能的下一个卡片起始
        if (row[0]?.value != null && String(row[0].value).includes(cardMarker)) break;

        const record: Record<string, any> = { ...cardRecord };
        let hasData = false;

        for (let c = 0; c < headers.length; c++) {
          const cell = row[c];
          if (headers[c]) {
            record[headers[c]] = cell?.value ?? null;
            if (cell?.value != null) hasData = true;
          }
        }

        if (hasData) {
          results.push(record);
        }
      }
    }

    return results;
  }
}

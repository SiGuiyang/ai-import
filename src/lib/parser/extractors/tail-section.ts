import type { Extractor } from "./index";
import type { UnifiedSheet, CellValue } from "../types";

export class TailSectionExtractor implements Extractor {
  type = "tail-section";

  extract(sheet: UnifiedSheet, config: Record<string, any>): Record<string, any>[] {
    const {
      startMarker,
      afterRow,
      extractMode = "horizontal",
      fieldPatterns = [],
    } = config;

    const cells = sheet.cells;
    if (!cells || cells.length === 0) return [];

    // 定位尾部区域起始行
    let tailStartRow = afterRow ?? cells.length;

    if (startMarker) {
      for (let r = 0; r < cells.length; r++) {
        const rowText = cells[r]
          .map((c: CellValue) => (c.value != null ? String(c.value) : ""))
          .join(" ");
        if (rowText.includes(startMarker)) {
          tailStartRow = Math.max(tailStartRow, r);
          break;
        }
      }
    }

    // 取尾部区域的行
    const tailRows = cells.slice(tailStartRow);

    const results: Record<string, any>[] = [{}];
    const record = results[0];

    if (extractMode === "horizontal") {
      // 横向模式：在某几行中按列偏移提取字段
      for (const fp of fieldPatterns) {
        const rowIdx = fp.rowOffset ?? 0;
        const colIdx = fp.colOffset ?? 0;
        const row = tailRows[rowIdx];
        if (!row) continue;

        if (fp.prefix) {
          // 按前缀匹配
          for (const cell of row) {
            if (cell.value != null && String(cell.value).includes(fp.prefix)) {
              record[fp.name] = String(cell.value).replace(fp.prefix, "").trim();
              break;
            }
          }
        } else if (fp.regex) {
          const cellValue = row[colIdx]?.value;
          if (cellValue != null) {
            const regex = new RegExp(fp.regex);
            const match = String(cellValue).match(regex);
            record[fp.name] = match ? match[1] || match[0] : String(cellValue);
          }
        } else {
          record[fp.name] = row[colIdx]?.value ?? null;
        }
      }
    } else if (extractMode === "vertical") {
      // 纵向模式：在某几列中按行偏移提取
      for (const fp of fieldPatterns) {
        const rowIdx = fp.rowOffset ?? 0;
        const colIdx = fp.colOffset ?? 0;
        const row = tailRows[rowIdx];
        if (!row) continue;

        if (fp.prefix) {
          for (const cell of row) {
            if (cell.value != null && String(cell.value).includes(fp.prefix)) {
              record[fp.name] = String(cell.value).replace(fp.prefix, "").trim();
              break;
            }
          }
        } else {
          record[fp.name] = row[colIdx]?.value ?? null;
        }
      }
    } else if (extractMode === "paragraph") {
      // 段落模式：从纯文本提取
      const tailText = tailRows
        .map((row) => row.map((c: CellValue) => (c.value != null ? String(c.value) : "")).join(" "))
        .join("\n");

      for (const fp of fieldPatterns) {
        if (fp.regex) {
          const regex = new RegExp(fp.regex, "s");
          const match = tailText.match(regex);
          record[fp.name] = match ? match[1]?.trim() || match[0]?.trim() : null;
        } else if (fp.prefix) {
          const prefixIndex = tailText.indexOf(fp.prefix);
          if (prefixIndex >= 0) {
            const after = tailText.slice(prefixIndex + fp.prefix.length);
            const lineEnd = after.indexOf("\n");
            record[fp.name] = (lineEnd >= 0 ? after.slice(0, lineEnd) : after).trim();
          }
        }
      }
    }

    return results;
  }
}

import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { UnifiedWorkbook, UnifiedSheet, CellValue, TextParagraph } from "./types";

// ============ Excel 预处理 ============
export async function preprocessExcel(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string
): Promise<UnifiedWorkbook> {
  // XLSX.read with type: "array" requires Uint8Array/Buffer (indexed access).
  // A raw ArrayBuffer does NOT support indexed access: arrayBuffer[0] → undefined,
  // which causes XLSX to read corrupted data and produce a workbook with
  // undefined sheets, leading to "Cannot read properties of undefined (reading '0')".
  const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const workbook = XLSX.read(data, { type: "array" });
  const sheets: UnifiedSheet[] = [];

  workbook.SheetNames.forEach((name) => {
    const ws = workbook.Sheets[name];
    // 转为二维数组，保留空值
    const jsonData = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      defval: null,
    });
    const cells: CellValue[][] = (jsonData as any[][]).map(
      (row: any[], rowIdx: number) =>
        row.map((val: any, colIdx: number) => ({
          value: val ?? null,
          row: rowIdx,
          col: colIdx,
        }))
    );

    // 处理合并单元格
    const merges = (ws as any)["!merges"] || [];
    merges.forEach((merge: XLSX.Range) => {
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (cells[r]?.[c]) {
            cells[r][c].mergeSpan = {
              rowSpan: merge.e.r - merge.s.r + 1,
              colSpan: merge.e.c - merge.s.c + 1,
            };
          }
        }
      }
    });

    const rawText = jsonData
      .map((row: any[]) => row.map((v) => (v != null ? String(v) : "")).join("\t"))
      .join("\n");

    sheets.push({ name, cells, rawText });
  });

  return {
    sheets,
    metadata: {
      fileName,
      fileType: fileName.endsWith(".xls") ? "xls" : "xlsx",
      totalSheets: sheets.length,
    },
  };
}

// ============ Word 预处理 ============
export async function preprocessWord(
  buffer: ArrayBuffer,
  fileName: string
): Promise<UnifiedWorkbook> {
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  const text = result.value;

  // 按段落拆分
  const paragraphs: TextParagraph[] = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => ({ index, text: line.trim() }));

  // 用二维数组表示（每个段落一行）
  const cells: CellValue[][] = paragraphs.map((p, rowIdx) => [
    { value: p.text, row: rowIdx, col: 0 },
  ]);

  const sheet: UnifiedSheet = {
    name: fileName,
    cells,
    rawText: text,
    paragraphs,
  };

  return {
    sheets: [sheet],
    metadata: { fileName, fileType: "docx", totalSheets: 1 },
  };
}

// ============ PDF 预处理 ============
export async function preprocessPdf(
  buffer: ArrayBuffer,
  fileName: string
): Promise<UnifiedWorkbook> {
  // 动态导入 pdf-parse 以避免 SSR 问题
  const pdfModule = await import("pdf-parse");
  const pdfParse = (pdfModule as any).default || pdfModule;
  const data = await pdfParse(Buffer.from(buffer));
  const fullText = data.text;

  // 按页拆分
  const pageTexts = fullText.split(/\f/).filter((t: string) => t.trim());
  const sheets: UnifiedSheet[] = pageTexts.map((pageText: string, pageIdx: number) => {
    const lines = pageText.split("\n").filter((line: string) => line.trim() !== "");
    const paragraphs: TextParagraph[] = lines.map((line: string, idx: number) => ({
      index: idx,
      text: line.trim(),
    }));

    const cells: CellValue[][] = paragraphs.map((p, rowIdx) => [
      { value: p.text, row: rowIdx, col: 0 },
    ]);

    return {
      name: `Page ${pageIdx + 1}`,
      cells,
      rawText: pageText,
      paragraphs,
    };
  });

  return {
    sheets: sheets.length > 0 ? sheets : [{ name: "Page 1", cells: [], rawText: fullText, paragraphs: [] }],
    metadata: { fileName, fileType: "pdf", totalSheets: sheets.length },
  };
}

// ============ 统一入口 ============
export async function preprocessFile(
  buffer: ArrayBuffer,
  fileType: string,
  fileName: string
): Promise<UnifiedWorkbook> {
  switch (fileType) {
    case "xlsx":
    case "xls":
      return preprocessExcel(buffer, fileName);
    case "docx":
      return preprocessWord(buffer, fileName);
    case "pdf":
      return preprocessPdf(buffer, fileName);
    default:
      throw new Error(`不支持的文件格式: ${fileType}。支持 .xlsx .xls .docx .pdf`);
  }
}

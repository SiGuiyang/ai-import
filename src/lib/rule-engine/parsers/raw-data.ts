import { parseAllSheets } from './excel-parser';

export interface RawRow {
  sheetName: string;
  rowIndex: number;
  cells: string[];
}

export interface RawData {
  type: 'excel' | 'word' | 'pdf';
  fileName: string;
  sheets?: Record<string, RawRow[]>;
  text?: string;
  rawBytes?: ArrayBuffer;
}

export function extractExcelData(buffer: ArrayBuffer | Buffer): RawData {
  const sheets = parseAllSheets(buffer);
  const result: Record<string, RawRow[]> = {};
  for (const [name, rows] of Object.entries(sheets)) {
    result[name] = rows.map((cells, idx) => ({
      sheetName: name,
      rowIndex: idx,
      cells,
    }));
  }
  return {
    type: 'excel',
    fileName: '',
    sheets: result,
  };
}

import * as XLSX from 'xlsx';

interface SheetData {
  name: string;
  rows: string[][];
  maxCols: number;
}

export function parseExcel(buffer: ArrayBuffer): SheetData[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  return workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const ref = sheet['!ref'];
    if (!ref) return { name, rows: [], maxCols: 0 };
    const range = XLSX.utils.decode_range(ref);
    const rows: string[][] = [];
    let maxCols = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        const val = cell ? cell.v : '';
        row.push(val !== undefined && val !== null ? String(val).trim() : '');
      }
      if (row.some(c => c.length > 0)) {
        rows.push(row);
        maxCols = Math.max(maxCols, row.length);
      }
    }
    return { name, rows, maxCols };
  });
}

export function parseExcelAsArrays(buffer: ArrayBuffer): string[][] {
  const sheets = parseExcel(buffer);
  if (sheets.length === 0) return [];
  return sheets[0].rows;
}

export function parseAllSheets(buffer: ArrayBuffer): Record<string, string[][]> {
  const sheets = parseExcel(buffer);
  const result: Record<string, string[][]> = {};
  for (const sheet of sheets) {
    result[sheet.name] = sheet.rows;
  }
  return result;
}

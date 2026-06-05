import type { ParseRule, ColumnMapping, TailExtraction, TransposeConfig, CardSplitConfig, CellSplitConfig } from '@/lib/types';
import type { RawData, RawRow } from './parsers/raw-data';
import { extractExcelData } from './parsers/raw-data';

export interface ParsedRecord {
  [key: string]: string;
  _rowIndex: string;
  _source: string;
}

function buildRowFromCells(
  cells: string[],
  headerRow: string[],
  mappings: ColumnMapping[],
  tailValues?: Record<string, string>
): Record<string, string> {
  const rec: Record<string, string> = {};
  for (const m of mappings) {
    if (m.sourceType === 'value') {
      rec[m.targetField] = m.defaultValue || '';
      continue;
    }
    if (m.sourceType === 'column') {
      let idx = m.sourceIndex !== undefined ? m.sourceIndex : -1;
      if (idx === -1 && m.sourceKey) {
        idx = headerRow.findIndex(h => h.includes(m.sourceKey!));
      }
      if (idx >= 0 && idx < cells.length) {
        rec[m.targetField] = cells[idx] || '';
      } else {
        rec[m.targetField] = m.defaultValue || '';
      }
    }
    if (m.sourceType === 'row') {
      rec[m.targetField] = m.defaultValue || '';
    }
  }
  if (tailValues) {
    for (const [k, v] of Object.entries(tailValues)) {
      if (!rec[k] || rec[k] === '') {
        rec[k] = v;
      }
    }
  }
  return rec;
}

function extractTailValues(
  rows: RawRow[],
  tailExtractions: TailExtraction[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const t of tailExtractions) {
    for (const row of rows) {
      const joined = row.cells.join('');
      if (joined.includes(t.rowMarker)) {
        result[t.field] = row.cells[t.columnIndex] || '';
        break;
      }
    }
  }
  return result;
}

function executeTranspose(
  dataRows: Record<string, string>[],
  config: TransposeConfig,
  headerRow: string[],
  dimensionField: string,
): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  for (const row of dataRows) {
    for (const header of config.dimensionHeaders) {
      const colIdx = headerRow.findIndex(h => h.includes(header));
      if (colIdx === -1 || colIdx >= Object.keys(row).length) continue;
      const val = row[headerRow[colIdx]] || '';
      if (!val || val === '0') continue;
      const newRow = { ...row };
      newRow[config.dimensionField] = header;
      const valKeys = Object.keys(row).filter(k => k === headerRow[colIdx]);
      newRow[config.valueField] = val;
      for (const vk of valKeys) delete newRow[vk];
      if (config.quantityField && config.quantityHeaderRow !== undefined) {
      }
      results.push(newRow);
    }
  }
  return results;
}

function executeCardSplit(
  rows: RawRow[],
  config: CardSplitConfig,
  mappings: ColumnMapping[],
  headerRow: string[],
): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  let i = 0;
  while (i < rows.length) {
    const joined = rows[i].cells.join('');
    if (joined.includes(config.startMarker)) {
      const headerLines = config.headerRowIndex !== undefined ? config.headerRowIndex : 1;
      const cardStart = i + 1;
      const cardHeaderEnd = cardStart + headerLines;
      let localHeader: string[] = [];
      if (cardHeaderEnd <= rows.length) {
        localHeader = rows[cardHeaderEnd - 1]?.cells || [];
      }
      let j = cardHeaderEnd;
      const itemRows: RawRow[] = [];
      while (j < rows.length) {
        const nextJoined = rows[j].cells.join('');
        if (nextJoined.includes(config.startMarker)) break;
        if (rows[j].cells.some(c => c.trim())) {
          itemRows.push(rows[j]);
        }
        j++;
      }
      const tailVals: Record<string, string> = {};
      for (const itemRow of itemRows.slice(config.tableRowsAfterMarker || 0)) {
        const joinedStr = itemRow.cells.join('');
        for (const m of mappings) {
          if (m.sourceType === 'row') {
            const idx = itemRow.cells.findIndex(c => c.includes(m.sourceKey || ''));
            if (idx >= 0 && idx + 1 < itemRow.cells.length) {
              tailVals[m.targetField] = itemRow.cells[idx + 1];
            }
          }
        }
      }
      for (const itemRow of itemRows.slice(0, config.tableRowsAfterMarker || itemRows.length)) {
        const rec = buildRowFromCells(itemRow.cells, localHeader, mappings, tailVals);
        rec._rowIndex = String(itemRow.rowIndex);
        results.push(rec);
      }
      i = j;
    } else {
      i++;
    }
  }
  return results;
}

function applyCellSplit(records: Record<string, string>[], config: CellSplitConfig): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  for (const rec of records) {
    const cellVal = rec[config.column] || '';
    if (!cellVal || !cellVal.includes('\n')) {
      results.push(rec);
      continue;
    }
    const lines = cellVal.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(new RegExp(config.pattern));
      if (match) {
        const newRec = { ...rec };
        for (let i = 0; i < config.targetFields.length; i++) {
          newRec[config.targetFields[i]] = match[i + 1]?.trim() || '';
        }
        delete newRec[config.column];
        results.push(newRec);
      } else {
        results.push({ ...rec, [config.column]: line.trim() });
      }
    }
  }
  return results;
}

function applyGroupBy(records: Record<string, string>[], groupBy: string): Record<string, string>[] {
  const groups: Record<string, Record<string, string>[]> = {};
  for (const rec of records) {
    const key = rec[groupBy] || '__nogroup__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(rec);
  }
  const results: Record<string, string>[] = [];
  for (const [, group] of Object.entries(groups)) {
    const base = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      for (const [k, v] of Object.entries(group[i])) {
        if (['skuCode', 'skuName', 'skuQuantity', 'skuSpec'].includes(k)) {
          base[k + '_' + i] = v;
        }
      }
    }
    results.push(base);
  }
  return results;
}

function detectHeaderRowFromMappings(rows: RawRow[], mappings: ColumnMapping[]): string[] {
  const headerKeys = mappings.filter(m => m.sourceKey).map(m => m.sourceKey);
  for (const row of rows) {
    const joined = row.cells.join('|');
    const matchCount = headerKeys.filter(k => joined.includes(k)).length;
    if (matchCount >= Math.min(2, headerKeys.length)) {
      return row.cells;
    }
  }
  return rows.length > 0 ? rows[0].cells : [];
}

export function executeRule(rule: ParseRule, raw: RawData): ParsedRecord[] {
  const result: ParsedRecord[] = [];

  if (raw.type === 'excel' && raw.sheets) {
    const sheetNames = Object.keys(raw.sheets);
    let sheetsToProcess: string[];
    if (rule.sourceArea.sheetMode === 'all') {
      sheetsToProcess = sheetNames;
    } else if (rule.sourceArea.sheetMode === 'named' && rule.sourceArea.sheetNames) {
      sheetsToProcess = rule.sourceArea.sheetNames.filter(n => sheetNames.includes(n));
    } else if (rule.sourceArea.sheetMode === 'index' && rule.sourceArea.sheetIndex !== undefined) {
      sheetsToProcess = [sheetNames[rule.sourceArea.sheetIndex]]; 
    } else {
      sheetsToProcess = [sheetNames[0]];
    }

    for (const sheetName of sheetsToProcess) {
      const rows = raw.sheets[sheetName] || [];
      const skippedRows = rows.slice(rule.sourceArea.headerSkipRows);
      
      let headerRow: string[];
      if (rule.sourceArea.headerRowIndex > 0 && rule.sourceArea.headerRowIndex <= skippedRows.length) {
        headerRow = skippedRows[rule.sourceArea.headerRowIndex - 1].cells;
      } else if (rule.sourceArea.headerRowIndex === 0) {
        headerRow = detectHeaderRowFromMappings(skippedRows, rule.columnMappings);
      } else {
        headerRow = skippedRows.length > 0 ? skippedRows[0].cells : [];
      }

      let dataRows: RawRow[];
      if (rule.sourceArea.dataEndMarker) {
        const endIdx = skippedRows.findIndex(r => r.cells.join('').includes(rule.sourceArea.dataEndMarker!));
        if (endIdx >= 0) {
          dataRows = skippedRows.slice(rule.sourceArea.dataStartRow, endIdx);
        } else {
          dataRows = skippedRows.slice(rule.sourceArea.dataStartRow);
        }
      } else if (rule.sourceArea.dataEndRow !== undefined) {
        dataRows = skippedRows.slice(rule.sourceArea.dataStartRow, rule.sourceArea.dataEndRow);
      } else {
        dataRows = skippedRows.slice(rule.sourceArea.dataStartRow);
      }

      const tailVals = extractTailValues(rows, rule.tailExtractions);

      let records: Record<string, string>[] = [];
      for (const row of dataRows) {
        if (rule.skipLinesRegex) {
          const joined = row.cells.join('');
          if (rule.skipLinesRegex.some(re => new RegExp(re).test(joined))) continue;
        }
        const rec = buildRowFromCells(row.cells, headerRow, rule.columnMappings, tailVals);
        rec._rowIndex = String(row.rowIndex);
        rec._source = sheetName;
        records.push(rec);
      }

      if (rule.transpose) {
        records = executeTranspose(records, rule.transpose, headerRow, rule.transpose.dimensionField);
      }

      if (rule.cellSplit) {
        records = applyCellSplit(records, rule.cellSplit);
      }

      if (rule.groupBy) {
        records = applyGroupBy(records, rule.groupBy);
      }

      result.push(...records.map(r => ({
        ...r,
        _sheetName: sheetName,
      })));
    }
  }

  if (raw.type === 'word' && raw.text) {
    const lines = raw.text.split('\n').map(l => l.trim()).filter(l => l);
    let records: Record<string, string>[] = [];
    let currentRec: Record<string, string> = {};
    let inRecord = false;

    for (const line of lines) {
      if (rule.cardSplit && line.includes(rule.cardSplit.startMarker)) {
        if (inRecord && Object.keys(currentRec).length > 0) {
          records.push(currentRec);
        }
        currentRec = {};
        inRecord = true;
        continue;
      }
      if (line.match(/^━━+$/) || line.match(/^[-]{3,}$/)) {
        if (inRecord && Object.keys(currentRec).length > 0) {
          records.push(currentRec);
        }
        currentRec = {};
        inRecord = true;
        continue;
      }
      for (const m of rule.columnMappings) {
        if (m.sourceType === 'row' && m.sourceKey && line.includes(m.sourceKey)) {
          const val = line.replace(m.sourceKey, '').trim().replace(/^[:：]/, '').trim();
          currentRec[m.targetField] = val;
        }
      }
      const itemMatch = line.match(/(\d+)[.、]\s*(\S+)\s*[|｜]\s*(\S+(?:\s*\S+)*?)\s*[|｜]\s*(\S+(?:\s*\S+)*?)\s*[|｜]\s*(\d+)/);
      if (itemMatch) {
        currentRec['skuCode'] = itemMatch[2];
        currentRec['skuName'] = itemMatch[3];
        currentRec['skuSpec'] = itemMatch[4];
        currentRec['skuQuantity'] = itemMatch[5];
        if (Object.keys(currentRec).length > 0 && !records.includes(currentRec)) {
          records.push({ ...currentRec });
        }
      }
    }
    if (inRecord && Object.keys(currentRec).length > 0) {
      records.push(currentRec);
    }
    result.push(...records.map((r, i) => ({
      ...r,
      _rowIndex: String(i),
      _source: 'word',
    })));
  }

  if (raw.type === 'pdf' && raw.text) {
    const lines = raw.text.split('\n').map(l => l.trim()).filter(l => l);
    let records: Record<string, string>[] = [];
    let currentRec: Record<string, string> = {};
    let inTable = false;
    let headerRow: string[] = [];

    for (const line of lines) {
      if (rule.cardSplit && line.includes(rule.cardSplit.startMarker)) {
        if (Object.keys(currentRec).length > 0) {
          records.push(currentRec);
        }
        currentRec = {};
        inTable = false;
        continue;
      }
      if (line.match(/^[-—]{3,}$/)) {
        if (inTable && Object.keys(currentRec).length > 0) {
          if (currentRec.skuCode || currentRec.skuName) {
            records.push(currentRec);
            currentRec = { ...currentRec };
            for (const k of ['skuCode', 'skuName', 'skuQuantity', 'skuSpec']) delete currentRec[k];
          }
        }
        inTable = !inTable;
        continue;
      }
      const cols = line.split(/\s{2,}/);
      if (cols.length >= 3 && !isNaN(Number(cols[cols.length - 1]))) {
        currentRec['skuCode'] = currentRec['skuCode'] || cols[0];
        currentRec['skuName'] = cols[Math.min(1, cols.length - 2)];
        currentRec['skuQuantity'] = cols[cols.length - 1];
        if (cols.length >= 4) currentRec['skuSpec'] = cols[2];
        const recCopy = { ...currentRec, _rowIndex: String(records.length), _source: 'pdf' };
        records.push(recCopy);
      }
      for (const m of rule.columnMappings) {
        if (m.sourceType === 'row' && m.sourceKey && line.includes(m.sourceKey)) {
          if (m.sourceKey.includes('收货') || m.sourceKey.includes('门店') || m.sourceKey.includes('地址') || m.sourceKey.includes('电话')) {
            const val = line.replace(m.sourceKey, '').replace(/^[:：\s]+/, '').trim();
            currentRec[m.targetField] = val;
          }
        }
      }
    }
    if (Object.keys(currentRec).length > 0) {
      records.push(currentRec);
    }

    const deduped = records.filter((rec, i, arr) => {
      return i === arr.findIndex(r => JSON.stringify(r) === JSON.stringify(rec));
    });
    result.push(...deduped.map(r => ({
      ...r,
      _source: 'pdf',
    })));
  }

  return result;
}

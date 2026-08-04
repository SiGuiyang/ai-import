import { NextRequest, NextResponse } from 'next/server';
import { extractExcelData } from '@/lib/rule-engine/parsers/raw-data';
import { executeRule } from '@/lib/rule-engine';
import { detectFileType } from '@/lib/utils';
import { extractPdfText } from '@/lib/pdf-parser';
import * as mammoth from 'mammoth';
import type { ParseRule } from '@/lib/types';

function validateRule(rule: unknown): { valid: boolean; error?: string; rule?: ParseRule } {
  if (!rule || typeof rule !== 'object') {
    return { valid: false, error: '规则格式无效' };
  }
  const r = rule as Record<string, unknown>;
  if (!r.sourceArea || typeof r.sourceArea !== 'object') {
    return { valid: false, error: '规则缺少 sourceArea 配置' };
  }
  const sa = r.sourceArea as Record<string, unknown>;
  if (sa.headerRowIndex === undefined && sa.headerRowIndex !== 0) {
    return { valid: false, error: '规则缺少 headerRowIndex' };
  }
  if (sa.dataStartRow === undefined || sa.dataStartRow === null) {
    return { valid: false, error: '规则缺少 dataStartRow' };
  }
  if (sa.headerSkipRows === undefined) {
    (sa as Record<string, number>).headerSkipRows = 0;
  }
  if (!r.columnMappings || !Array.isArray(r.columnMappings) || r.columnMappings.length === 0) {
    return { valid: false, error: '规则缺少列映射配置 (columnMappings)' };
  }
  return { valid: true, rule: r as unknown as ParseRule };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const ruleJson = formData.get('rule') as string;

    if (!file || !ruleJson) {
      return NextResponse.json({ success: false, error: '缺少文件或解析规则' }, { status: 400 });
    }

    const fileType = detectFileType(file.name);
    if (!fileType) {
      return NextResponse.json({ success: false, error: '不支持的文件类型' }, { status: 400 });
    }

    let parsedRule: unknown;
    try {
      parsedRule = JSON.parse(ruleJson);
    } catch {
      return NextResponse.json({ success: false, error: '规则 JSON 格式无效' }, { status: 400 });
    }

    // 如果规则中没有 fileType，使用文件名推断
    if (parsedRule && typeof parsedRule === 'object' && !(parsedRule as Record<string, unknown>).fileType) {
      (parsedRule as Record<string, unknown>).fileType = fileType;
    }

    const validation = validateRule(parsedRule);
    if (!validation.valid) {
      console.error('[parse] 规则校验失败:', validation.error, '规则:', JSON.stringify(parsedRule).slice(0, 500));
      return NextResponse.json({ success: false, error: validation.error! }, { status: 400 });
    }
    const rule = validation.rule!;

    const buffer = Buffer.from(await file.arrayBuffer());
    const startTime = Date.now();

    let parsedData: Record<string, unknown>[];

    if (fileType === 'excel') {
      const raw = extractExcelData(buffer);
      console.log('[parse] Excel sheets:', Object.keys(raw.sheets || {}));
      const firstSheet = Object.keys(raw.sheets || {})[0];
      if (firstSheet) {
        const rows = raw.sheets![firstSheet];
        console.log('[parse] rows count:', rows?.length, 'headerRowIndex:', rule.sourceArea.headerRowIndex,
          'dataStartRow:', rule.sourceArea.dataStartRow, 'headerSkipRows:', rule.sourceArea.headerSkipRows,
          'columnMappings count:', rule.columnMappings?.length);
        if (rows && rows.length > 0) {
          console.log('[parse] first row sample:', JSON.stringify(rows[0]?.cells?.slice(0, 5)));
        }
      }
      parsedData = executeRule(rule, raw);
    } else if (fileType === 'word') {
      const result = await mammoth.extractRawText({ buffer });
      const raw = { type: 'word' as const, fileName: file.name, text: result.value };
      parsedData = executeRule(rule, raw);
    } else if (fileType === 'pdf') {
      const { text } = await extractPdfText(buffer);
      const raw = { type: 'pdf' as const, fileName: file.name, text };
      parsedData = executeRule(rule, raw);
    } else {
      return NextResponse.json({ success: false, error: '不支持的文件类型' }, { status: 400 });
    }

    const parseTime = Date.now() - startTime;

    if (parsedData.length === 0) {
      console.warn('[parse] 解析结果为 0 条记录，请检查规则是否匹配当前文件');
    }

    return NextResponse.json({
      success: true,
      data: parsedData,
      totalRows: parsedData.length,
      parseTime,
      fileName: file.name,
    });
  } catch (e) {
    console.error('[parse] 解析异常:', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

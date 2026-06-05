import { NextRequest, NextResponse } from 'next/server';
import { parseExcelAsArrays } from '@/lib/rule-engine/parsers/excel-parser';
import { extractExcelData } from '@/lib/rule-engine/parsers/raw-data';
import { executeRule } from '@/lib/rule-engine';
import { detectFileType } from '@/lib/utils';
import * as mammoth from 'mammoth';
import type { ParseRule } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const ruleJson = formData.get('rule') as string;

    if (!file || !ruleJson) {
      return NextResponse.json({ error: 'Missing file or rule' }, { status: 400 });
    }

    const fileType = detectFileType(file.name);
    if (!fileType) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    let rule: ParseRule;
    try {
      rule = JSON.parse(ruleJson);
    } catch {
      return NextResponse.json({ error: 'Invalid rule JSON' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const startTime = Date.now();

    let parsedData: Record<string, unknown>[];

    if (fileType === 'excel') {
      const raw = extractExcelData(buffer);
      parsedData = executeRule(rule, raw);
    } else if (fileType === 'word') {
      const result = await mammoth.extractRawText({ buffer });
      const raw = { type: 'word' as const, fileName: file.name, text: result.value };
      parsedData = executeRule(rule, raw);
    } else if (fileType === 'pdf') {
      const raw = { type: 'pdf' as const, fileName: file.name, text: `[PDF parsed text from ${file.name}]` };
      parsedData = executeRule(rule, raw);
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const parseTime = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      data: parsedData,
      totalRows: parsedData.length,
      parseTime,
      fileName: file.name,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

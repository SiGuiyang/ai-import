import { NextRequest, NextResponse } from 'next/server';
import { parseExcelAsArrays } from '@/lib/rule-engine/parsers/excel-parser';
import { buildRuleGenerationPrompt } from '@/lib/ai/prompts';
import { callQwen } from '@/lib/ai';
import { detectFileType } from '@/lib/utils';
import { extractPdfText } from '@/lib/pdf-parser';
import * as mammoth from 'mammoth';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const fileType = detectFileType(file.name);
    if (!fileType) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let fileContent = '';
    let filePreview = '';

    if (fileType === 'excel') {
      try {
        const rows = parseExcelAsArrays(buffer);
        fileContent = rows.slice(0, 30).map(r => r.join('\t')).join('\n');
        filePreview = rows.slice(0, 5).map(r => r.join('\t')).join('\n');
      } catch {
        fileContent = `[Excel binary file: ${file.name}, ${buffer.length} bytes]`;
        filePreview = fileContent;
      }
    } else if (fileType === 'word') {
      try {
        const result = await mammoth.extractRawText({ buffer });
        fileContent = result.value;
        filePreview = result.value.slice(0, 1000);
      } catch {
        fileContent = `[Word binary file: ${file.name}, ${buffer.length} bytes]`;
        filePreview = fileContent;
      }
    } else if (fileType === 'pdf') {
      try {
        const { text } = await extractPdfText(buffer);
        fileContent = text.slice(0, 3000);
        filePreview = text.slice(0, 1000);
      } catch (e) {
        fileContent = `[PDF binary file: ${file.name}, ${buffer.length} bytes]`;
        filePreview = fileContent;
      }
    }

    const prompt = buildRuleGenerationPrompt(fileContent, fileType);
    const aiResponse = await callQwen([
      { role: 'system', content: '你是一个出库单解析规则生成器。只输出JSON，不要任何其他文字。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.1 });

    let rule;
    try {
      const cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      rule = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({
        error: 'AI response parse failed',
        raw: aiResponse,
        filePreview,
      }, { status: 422 });
    }

    return NextResponse.json({
      rule,
      filePreview,
      fileName: file.name,
      fileType,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

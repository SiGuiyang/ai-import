import { NextRequest, NextResponse } from 'next/server';
import { parseExcelAsArrays } from '@/lib/rule-engine/parsers/excel-parser';
import { buildDirectParsePrompt } from '@/lib/ai/prompts';
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
        fileContent = rows.slice(0, 40).map(r => r.join('\t')).join('\n');
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
        fileContent = text.slice(0, 4000);
        filePreview = text.slice(0, 1000);
      } catch {
        fileContent = `[PDF binary file: ${file.name}, ${buffer.length} bytes]`;
        filePreview = fileContent;
      }
    }

    // 使用更大的 maxTokens 让 AI 能返回完整数据
    const prompt = buildDirectParsePrompt(fileContent, fileType, file.name);
    const aiResponse = await callQwen([
      { role: 'system', content: '你是一个出库单/配送单数据提取专家。只输出JSON数组，不要任何其他文字。' },
      { role: 'user', content: prompt },
    ], { temperature: 0.05, maxTokens: 8192 });

    let parsedData: Record<string, unknown>[];
    try {
      const cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsedData = JSON.parse(cleaned);
      if (!Array.isArray(parsedData)) {
        // 如果返回的是单个对象，包装为数组
        if (typeof parsedData === 'object' && parsedData !== null) {
          parsedData = [parsedData as unknown as Record<string, unknown>];
        } else {
          throw new Error('AI response is not an array or object');
        }
      }
    } catch (parseErr) {
      return NextResponse.json({
        error: 'AI 返回数据解析失败，请重试',
        raw: aiResponse.slice(0, 500),
        filePreview,
      }, { status: 422 });
    }

    // 标准化每条记录：确保必要字段存在
    const normalizedData = parsedData.map((rec: any, idx: number) => ({
      externalCode: rec.externalCode || rec.外部编码 || '',
      receiverStore: rec.receiverStore || rec.收货门店 || rec.门店 || '',
      receiverName: rec.receiverName || rec.收件人 || rec.收货人 || '',
      receiverPhone: rec.receiverPhone || rec.电话 || rec.收货电话 || '',
      receiverAddress: rec.receiverAddress || rec.地址 || rec.收货地址 || '',
      skuCode: rec.skuCode || rec.SKU编码 || rec.编码 || '',
      skuName: rec.skuName || rec.SKU名称 || rec.名称 || rec.物品名称 || '',
      skuQuantity: rec.skuQuantity || rec.数量 || rec.发货数量 || '',
      skuSpec: rec.skuSpec || rec.规格 || rec.规格型号 || '',
      remark: rec.remark || rec.备注 || '',
      _rowIndex: String(idx),
      _source: fileType,
    }));

    return NextResponse.json({
      success: true,
      data: normalizedData,
      totalRows: normalizedData.length,
      filePreview,
      fileName: file.name,
      fileType,
      parseMode: 'ai-direct',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

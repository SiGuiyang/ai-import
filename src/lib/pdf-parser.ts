/**
 * PDF 文本提取工具（服务端可用）
 * 使用 pdfjs-dist legacy build，无需 canvas
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import path from 'path';

interface TextItem {
  str: string;
  transform: number[];
}

export interface PdfExtractResult {
  text: string;          // 全文，行之间用 \n 分隔
  pageTexts: string[];   // 每页文本
  numPages: number;
}

async function getPdfLib() {
  // dynamic import 避免 SSR bundle 体积问题
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as string);
  // 设置 worker 路径（服务端 Node.js 环境下需要真实路径）
  const workerSrc = path.resolve(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  );
  (pdfjs as any).GlobalWorkerOptions.workerSrc = `file://${workerSrc}`;
  return pdfjs as any;
}

/** 按行重建文本（基于 y 坐标分组） */
function itemsToLines(items: TextItem[]): string[] {
  if (items.length === 0) return [];

  // 按 y 坐标降序排列（PDF 坐标系 y 从下往上）
  const sorted = [...items].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 3) return dy;
    return a.transform[4] - b.transform[4]; // 同行按 x 排
  });

  const lines: string[] = [];
  let lastY: number | null = null;
  let currentLine: string[] = [];

  for (const item of sorted) {
    const y = item.transform[5];
    if (lastY === null || Math.abs(y - lastY) > 3) {
      if (currentLine.length > 0) {
        lines.push(currentLine.join(' ').trim());
      }
      currentLine = [item.str];
      lastY = y;
    } else {
      currentLine.push(item.str);
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine.join(' ').trim());
  }

  return lines.filter(l => l.length > 0);
}

export async function extractPdfText(buffer: Buffer | ArrayBuffer): Promise<PdfExtractResult> {
  const pdfjs = await getPdfLib();
  const data = buffer instanceof Buffer ? new Uint8Array(buffer) : new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });

  const pdf: PDFDocumentProxy = await loadingTask.promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const lines = itemsToLines(textContent.items as TextItem[]);
    pageTexts.push(lines.join('\n'));
  }

  return {
    text: pageTexts.join('\n'),
    pageTexts,
    numPages: pdf.numPages,
  };
}

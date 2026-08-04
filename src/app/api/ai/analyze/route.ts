import { NextRequest, NextResponse } from "next/server";
import { preprocessFile } from "@/lib/parser/preprocessor";
import { analyzeFileStructure } from "@/lib/ai/analyzer";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "请上传文件" },
        { status: 400 }
      );
    }

    const fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const validExts = ["xlsx", "xls", "docx", "pdf"];

    if (!validExts.includes(ext)) {
      return NextResponse.json(
        { success: false, error: `不支持的文件格式: .${ext}。支持 ${validExts.join(", ")}` },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();

    // 文件大小检查
    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: "文件为空" },
        { status: 400 }
      );
    }

    if (buffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "文件大小不能超过 20MB" },
        { status: 400 }
      );
    }

    // 预处理文件
    const workbook = await preprocessFile(buffer, ext, fileName);

    // 采样文本用于 AI 分析
    let sampleText = "";
    for (const sheet of workbook.sheets) {
      sampleText += `\n--- Sheet: ${sheet.name} ---\n`;
      sampleText += (sheet.rawText || "").slice(0, 6000);
      if (sampleText.length > 8000) break;
    }

    // AI 分析文件结构
    let aiResult: any = null;
    let aiError: string | null = null;

    try {
      aiResult = await analyzeFileStructure(sampleText, workbook.metadata);
    } catch (err: any) {
      console.error("AI 分析失败:", err.message);
      aiError = "AI 分析失败，请手动配置规则";
    }

    return NextResponse.json({
      success: true,
      data: {
        fileName,
        fileType: ext,
        fileSize: buffer.byteLength,
        sheets: workbook.sheets.map((s) => ({
          name: s.name,
          rowCount: s.cells.length,
          preview: (s.rawText || "").slice(0, 2000),
        })),
        analysis: aiResult,
        aiError,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "文件分析失败" },
      { status: 500 }
    );
  }
}

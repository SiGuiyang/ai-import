import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileImports } from "@/lib/db/schema";
import { v4 as uuidv4 } from "uuid";

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
        { success: false, error: `不支持的文件格式: .${ext}` },
        { status: 400 }
      );
    }

    const buffer = await file.arrayBuffer();

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

    // 保存文件 Buffer（作为 base64 存储到数据库 raw_content 中）
    const base64Content = Buffer.from(buffer).toString("base64");

    const [record] = await db
      .insert(fileImports)
      .values({
        id: uuidv4(),
        fileName,
        fileType: ext,
        fileSize: buffer.byteLength,
        status: "uploading",
        rawContent: { fileBuffer: base64Content, encoding: "base64" },
      })
      .returning();

    return NextResponse.json(
      { success: true, data: { id: record.id, fileName, fileType: ext, fileSize: buffer.byteLength } },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "文件上传失败" },
      { status: 500 }
    );
  }
}

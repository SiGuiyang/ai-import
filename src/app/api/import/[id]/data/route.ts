import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileImports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/import/[id]/data - 获取解析数据
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [record] = await db
      .select()
      .from(fileImports)
      .where(eq(fileImports.id, params.id));

    if (!record) {
      return NextResponse.json(
        { success: false, error: "导入记录不存在" },
        { status: 404 }
      );
    }

    const rawContent = record.rawContent as any;
    const orders = rawContent?.parsedOrders || [];

    return NextResponse.json({
      success: true,
      data: {
        id: record.id,
        fileName: record.fileName,
        fileType: record.fileType,
        status: record.status,
        totalRows: record.totalRows,
        parsedRows: record.parsedRows,
        orders,
        errors: rawContent?.errors || [],
        errorMessage: record.errorMessage,
        ruleId: record.ruleId,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "获取数据失败" },
      { status: 500 }
    );
  }
}

// PUT /api/import/[id]/data - 更新数据
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { orders: updatedOrders } = body;

    if (!updatedOrders) {
      return NextResponse.json(
        { success: false, error: "缺少 orders 数据" },
        { status: 400 }
      );
    }

    const [record] = await db
      .select()
      .from(fileImports)
      .where(eq(fileImports.id, params.id));

    if (!record) {
      return NextResponse.json(
        { success: false, error: "导入记录不存在" },
        { status: 404 }
      );
    }

    const rawContent = record.rawContent as any;
    await db
      .update(fileImports)
      .set({
        rawContent: { ...rawContent, parsedOrders: updatedOrders },
        totalRows: updatedOrders.length,
      })
      .where(eq(fileImports.id, params.id));

    return NextResponse.json({ success: true, data: null });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "更新数据失败" },
      { status: 500 }
    );
  }
}

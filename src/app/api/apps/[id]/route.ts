import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openApps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/apps/[id] - 获取应用详情
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [app] = await db
      .select()
      .from(openApps)
      .where(eq(openApps.id, params.id));

    if (!app) {
      return NextResponse.json(
        { success: false, message: "应用不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: app });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "获取应用详情失败" },
      { status: 500 }
    );
  }
}

// PUT /api/apps/[id] - 更新应用
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, description, status } = body;

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;

    const [result] = await db
      .update(openApps)
      .set(updateData)
      .where(eq(openApps.id, params.id))
      .returning();

    if (!result) {
      return NextResponse.json(
        { success: false, message: "应用不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "更新应用失败" },
      { status: 500 }
    );
  }
}

// DELETE /api/apps/[id] - 删除应用
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await db.delete(openApps).where(eq(openApps.id, params.id));
    return NextResponse.json({ success: true, message: "应用已删除" });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "删除应用失败" },
      { status: 500 }
    );
  }
}

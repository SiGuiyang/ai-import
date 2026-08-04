import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parsingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/rules/[id] - 获取单条规则
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [rule] = await db
      .select()
      .from(parsingRules)
      .where(eq(parsingRules.id, params.id));

    if (!rule) {
      return NextResponse.json(
        { success: false, error: "规则不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: rule });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "获取规则失败" },
      { status: 500 }
    );
  }
}

// PUT /api/rules/[id] - 更新规则
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { name, description, steps, fieldMapping } = body;

    const [rule] = await db
      .update(parsingRules)
      .set({
        name: name || undefined,
        description: description !== undefined ? description : undefined,
        steps: steps || undefined,
        fieldMapping: fieldMapping || undefined,
        updatedAt: new Date(),
      })
      .where(eq(parsingRules.id, params.id))
      .returning();

    if (!rule) {
      return NextResponse.json(
        { success: false, error: "规则不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: rule });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "更新规则失败" },
      { status: 500 }
    );
  }
}

// DELETE /api/rules/[id] - 删除规则
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await db.delete(parsingRules).where(eq(parsingRules.id, params.id));
    return NextResponse.json({ success: true, data: null });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "删除规则失败" },
      { status: 500 }
    );
  }
}

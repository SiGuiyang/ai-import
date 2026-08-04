import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parsingRules } from "@/lib/db/schema";
import { like, desc } from "drizzle-orm";

// GET /api/rules - 获取规则列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";

    let query = db
      .select()
      .from(parsingRules)
      .orderBy(desc(parsingRules.updatedAt));

    if (search) {
      query = query.where(like(parsingRules.name, `%${search}%`)) as any;
    }

    const rules = await query;
    return NextResponse.json({ success: true, data: rules });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "获取规则列表失败" },
      { status: 500 }
    );
  }
}

// POST /api/rules - 创建规则
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, steps, fieldMapping, createdByLlm } = body;

    if (!name || !steps || !fieldMapping) {
      return NextResponse.json(
        { success: false, error: "缺少必要字段：name, steps, fieldMapping" },
        { status: 400 }
      );
    }

    const [rule] = await db
      .insert(parsingRules)
      .values({
        name,
        description: description || "",
        steps: steps as any,
        fieldMapping: fieldMapping as any,
        createdByLlm: createdByLlm || false,
        usageCount: 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "创建规则失败" },
      { status: 500 }
    );
  }
}

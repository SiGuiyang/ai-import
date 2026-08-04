import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parsingRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// POST /api/rules/[id]/copy - 复制规则
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [original] = await db
      .select()
      .from(parsingRules)
      .where(eq(parsingRules.id, params.id));

    if (!original) {
      return NextResponse.json(
        { success: false, error: "原规则不存在" },
        { status: 404 }
      );
    }

    const [copy] = await db
      .insert(parsingRules)
      .values({
        name: `${original.name} (副本)`,
        description: original.description,
        steps: original.steps,
        fieldMapping: original.fieldMapping,
        createdByLlm: false,
        usageCount: 0,
      })
      .returning();

    return NextResponse.json({ success: true, data: copy }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "复制规则失败" },
      { status: 500 }
    );
  }
}

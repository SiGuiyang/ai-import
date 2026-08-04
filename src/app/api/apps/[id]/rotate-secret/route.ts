import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openApps } from "@/lib/db/schema";
import { generateAppSecret } from "@/lib/signature";
import { eq } from "drizzle-orm";

// POST /api/apps/[id]/rotate-secret - 重置 AppSecret
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const newSecret = generateAppSecret();

    const [result] = await db
      .update(openApps)
      .set({
        appSecret: newSecret,
        updatedAt: new Date(),
      })
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
      { success: false, message: error.message || "重置 AppSecret 失败" },
      { status: 500 }
    );
  }
}

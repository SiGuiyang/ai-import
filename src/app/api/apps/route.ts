import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { openApps } from "@/lib/db/schema";
import { generateAppId, generateAppSecret } from "@/lib/signature";
import { desc, like } from "drizzle-orm";

// GET /api/apps - 获取应用列表
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword") || "";

  try {
    let apps;
    if (keyword) {
      apps = await db
        .select()
        .from(openApps)
        .where(like(openApps.name, `%${keyword}%`))
        .orderBy(desc(openApps.createdAt));
    } else {
      apps = await db
        .select()
        .from(openApps)
        .orderBy(desc(openApps.createdAt));
    }

    return NextResponse.json({ success: true, data: apps });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "获取应用列表失败" },
      { status: 500 }
    );
  }
}

// POST /api/apps - 创建应用
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { success: false, message: "应用名称不能为空" },
        { status: 400 }
      );
    }

    const appId = generateAppId();
    const appSecret = generateAppSecret();

    const [result] = await db
      .insert(openApps)
      .values({
        name: name.trim(),
        appId,
        appSecret,
        description: description || "",
        status: "active",
      })
      .returning();

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || "创建应用失败" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTaskErrors } from "@/lib/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";

/**
 * GET /api/import-tasks/:id/errors
 * 查询行级错误明细（分页）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const shardIndex = searchParams.get("shardIndex");
    const errorCode = searchParams.get("errorCode");
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");

    const conditions = [eq(importTaskErrors.taskId, id as any)];

    if (shardIndex !== null && shardIndex !== undefined) {
      conditions.push(eq(importTaskErrors.shardIndex, parseInt(shardIndex)));
    }
    if (errorCode) {
      conditions.push(eq(importTaskErrors.errorCode, errorCode));
    }

    const finalWhere =
      conditions.length > 1 ? and(...conditions) : conditions[0];

    const [errors, countResult] = await Promise.all([
      db
        .select()
        .from(importTaskErrors)
        .where(finalWhere)
        .orderBy(desc(importTaskErrors.rowNumber))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(importTaskErrors)
        .where(finalWhere),
    ]);

    return NextResponse.json({
      errors,
      total: countResult[0]?.count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error("[ImportErrors] Query failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to query errors" },
      { status: 500 }
    );
  }
}

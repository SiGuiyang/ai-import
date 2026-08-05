import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks, parsingRules, orders } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/**
 * GET /api/dashboard/stats
 * 返回仪表盘首页统计：
 * - 今日导入任务数
 * - 解析规则总数
 * - 总运单数
 */
export async function GET() {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [todayImport, rulesCount, ordersCount] = await Promise.all([
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(importTasks)
        .where(sql`${importTasks.createdAt} >= ${todayStart.toISOString()}`),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(parsingRules),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(orders),
    ]);

    return NextResponse.json({
      todayImportCount: todayImport[0]?.count ?? 0,
      rulesCount: rulesCount[0]?.count ?? 0,
      ordersCount: ordersCount[0]?.count ?? 0,
    });
  } catch (error: any) {
    console.error("[Dashboard] Stats failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get dashboard stats" },
      { status: 500 }
    );
  }
}

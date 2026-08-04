import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orders, orderItems } from "@/lib/db/schema";
import { desc, like, or, and, gte, lte, sql } from "drizzle-orm";

// GET /api/orders - 运单列表
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");
    const search = searchParams.get("search") || "";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const conditions: any[] = [];
    if (search) {
      conditions.push(
        or(
          like(orders.externalCode, `%${search}%`),
          like(orders.receiverName, `%${search}%`)
        ) as any
      );
    }
    if (startDate) {
      conditions.push(gte(orders.submittedAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(orders.submittedAt, new Date(endDate)));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // 查询总数
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(orders)
      .where(where as any);

    const total = Number(countResult[0]?.count || 0);

    // 查询列表
    const orderList = await db
      .select()
      .from(orders)
      .where(where as any)
      .orderBy(desc(orders.submittedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 查询每个订单的 SKU 数量
    const orderIds = orderList.map((o) => o.id);
    const skuCounts: Record<string, number> = {};

    if (orderIds.length > 0) {
      const itemCounts = await db
        .select({
          orderId: orderItems.orderId,
          count: sql<number>`count(*)`,
        })
        .from(orderItems)
        .where(
          sql`${orderItems.orderId} IN (${orderIds.map((id) => `'${id}'`).join(",")})`
        )
        .groupBy(orderItems.orderId);

      itemCounts.forEach((row: any) => {
        skuCounts[row.orderId] = Number(row.count);
      });
    }

    const data = orderList.map((order) => ({
      ...order,
      skuCount: skuCounts[order.id] || 0,
    }));

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "获取运单列表失败" },
      { status: 500 }
    );
  }
}

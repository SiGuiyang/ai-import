import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orders, orderItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// GET /api/orders/[id] - 运单详情
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, params.id));

    if (!order) {
      return NextResponse.json(
        { success: false, error: "运单不存在" },
        { status: 404 }
      );
    }

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, params.id))
      .orderBy(orderItems.sortOrder);

    return NextResponse.json({
      success: true,
      data: { ...order, items },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "获取运单详情失败" },
      { status: 500 }
    );
  }
}

// PATCH /api/orders/[id] - 提交运单（draft -> submitted）
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, params.id));

    if (!order) {
      return NextResponse.json(
        { success: false, error: "运单不存在" },
        { status: 404 }
      );
    }

    if (order.status !== "draft") {
      return NextResponse.json(
        { success: false, error: "只有草稿状态的运单可以提交" },
        { status: 400 }
      );
    }

    await db
      .update(orders)
      .set({
        status: "submitted",
        submittedAt: new Date(),
      })
      .where(eq(orders.id, params.id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "提交运单失败" },
      { status: 500 }
    );
  }
}

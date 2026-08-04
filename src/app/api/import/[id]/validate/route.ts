import { NextRequest, NextResponse } from "next/server";
import { validateOrders } from "@/lib/validation/validator";
import type { ParsedOrder } from "@/lib/parser/types";

// POST /api/import/[id]/validate - 数据校验
export async function POST(
  request: NextRequest
) {
  try {
    const body = await request.json();
    const { orders } = body;

    if (!orders || !Array.isArray(orders)) {
      return NextResponse.json(
        { success: false, error: "缺少 orders 数据" },
        { status: 400 }
      );
    }

    const errors = validateOrders(orders as ParsedOrder[]);

    return NextResponse.json({
      success: true,
      data: {
        valid: errors.length === 0,
        errorCount: errors.length,
        errors,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "校验失败" },
      { status: 500 }
    );
  }
}

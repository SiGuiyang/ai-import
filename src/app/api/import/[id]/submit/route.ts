import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fileImports, orders, orderItems } from "@/lib/db/schema";
import { validateOrders } from "@/lib/validation/validator";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// POST /api/import/[id]/submit - 提交下单
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { orders: submitOrders } = body;

    if (!submitOrders || !Array.isArray(submitOrders)) {
      return NextResponse.json(
        { success: false, error: "缺少 orders 数据" },
        { status: 400 }
      );
    }

    // 先校验
    const errors = validateOrders(submitOrders);
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `存在 ${errors.length} 个校验错误，请修正后提交`,
          errors,
        },
        { status: 400 }
      );
    }

    // 获取导入记录
    const [importRecord] = await db
      .select()
      .from(fileImports)
      .where(eq(fileImports.id, params.id));

    if (!importRecord) {
      return NextResponse.json(
        { success: false, error: "导入记录不存在" },
        { status: 404 }
      );
    }

    // 写入数据库
    let successCount = 0;
    let failedCount = 0;
    const submitErrors: string[] = [];

    for (const order of submitOrders) {
      try {
        const orderId = uuidv4();
        await db.insert(orders).values({
          id: orderId,
          externalCode: order.externalCode || null,
          importId: params.id,
          storeName: order.storeName || null,
          receiverName: order.receiverName || null,
          receiverPhone: order.receiverPhone || null,
          receiverAddress: order.receiverAddress || null,
          remark: order.remark || null,
          status: "submitted",
          submittedAt: new Date(),
        });

        if (order.items && Array.isArray(order.items)) {
          for (let i = 0; i < order.items.length; i++) {
            const item = order.items[i];
            await db.insert(orderItems).values({
              id: uuidv4(),
              orderId: orderId,
              skuCode: item.skuCode,
              skuName: item.skuName,
              quantity: Number(item.quantity),
              specification: item.specification || null,
              sortOrder: i,
            });
          }
        }

        successCount++;
      } catch (err: any) {
        failedCount++;
        submitErrors.push(`第${submitOrders.indexOf(order) + 1}条: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        success: successCount,
        failed: failedCount,
        errors: submitErrors,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "提交失败" },
      { status: 500 }
    );
  }
}

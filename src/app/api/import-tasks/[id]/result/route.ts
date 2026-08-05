import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  importTasks,
  importTaskShards,
  importTaskErrors,
  batchPerformanceLog,
  orders,
  orderItems,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;

    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, id));

    if (!task) {
      return NextResponse.json(
        { success: false, error: "任务不存在" },
        { status: 404 }
      );
    }

    if (task.status === "pending" || task.status === "processing") {
      return NextResponse.json(
        {
          success: false,
          error: "任务尚未完成",
          status: task.status,
        },
        { status: 202 }
      );
    }

    // 查询分片汇总
    const shards = await db
      .select()
      .from(importTaskShards)
      .where(eq(importTaskShards.taskId, id));

    // 查询错误
    const errors = await db
      .select({
        shardIndex: importTaskErrors.shardIndex,
        rowNumber: importTaskErrors.rowNumber,
        fieldName: importTaskErrors.fieldName,
        rawValue: importTaskErrors.rawValue,
        errorCode: importTaskErrors.errorCode,
        errorReason: importTaskErrors.errorReason,
      })
      .from(importTaskErrors)
      .where(eq(importTaskErrors.taskId, id))
      .orderBy(importTaskErrors.rowNumber);

    // 查询性能日志
    const perfLogs = await db
      .select({
        shardIndex: batchPerformanceLog.shardIndex,
        rowCount: batchPerformanceLog.rowCount,
        parseDurationMs: batchPerformanceLog.parseDurationMs,
        validateDurationMs: batchPerformanceLog.validateDurationMs,
        insertDurationMs: batchPerformanceLog.insertDurationMs,
        totalDurationMs: batchPerformanceLog.totalDurationMs,
        status: batchPerformanceLog.status,
      })
      .from(batchPerformanceLog)
      .where(eq(batchPerformanceLog.taskId, id))
      .orderBy(batchPerformanceLog.shardIndex);

    // 查询订单数据（结果页显示用）
    const taskOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.taskId, id))
      .limit(500); // 限制返回数量，分页再加载

    // 查询订单的 items（批量）
    const itemsMap: Record<string, any[]> = {};
    if (taskOrders.length > 0) {
      const orderIds = taskOrders.map((o) => o.id);
      const allItems = await db
        .select()
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds as any))
        .orderBy(orderItems.sortOrder);

      for (const item of allItems) {
        if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
        itemsMap[item.orderId].push(item);
      }
    }

    const orderResults = taskOrders.map((order) => ({
      ...order,
      items: itemsMap[order.id] || [],
    }));

    return NextResponse.json({
      success: true,
      data: {
        task: {
          id: task.id,
          status: task.status,
          totalRows: task.totalRows || 0,
          parsedRows: task.parsedRows || 0,
          processedRows: task.processedRows || 0,
          error: task.error || null,
          degraded: task.degraded || false,
          fileName: task.fileName,
          fileType: task.fileType,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
        },
        shards: {
          total: shards.length,
          completed: shards.filter((s) => s.status === "completed").length,
          failed: shards.filter((s) => s.status === "failed").length,
        },
        errors: errors.map((e) => ({
          shardIndex: e.shardIndex,
          rowNumber: e.rowNumber,
          fieldName: e.fieldName,
          rawValue: e.rawValue,
          errorCode: e.errorCode,
          errorReason: e.errorReason,
        })),
        performance: perfLogs.map((p) => ({
          shardIndex: p.shardIndex,
          rowCount: p.rowCount,
          durations: {
            parse: p.parseDurationMs,
            validate: p.validateDurationMs,
            insert: p.insertDurationMs,
            total: p.totalDurationMs,
          },
          status: p.status,
        })),
        orders: orderResults,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

import { Job } from "bullmq";
import { db } from "@/lib/db";
import {
  importTasks,
  importTaskShards,
  importTaskErrors,
  batchPerformanceLog,
  skuMaster,
  orders,
  orderItems,
} from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { addTraceEvent } from "@/lib/trace";
import { preprocessFile } from "@/lib/parser/preprocessor";
import { parseFileWithRule } from "@/lib/parser/engine";
import {
  buildDegradationMessage,
} from "./degradation";
import type { ImportShardJobData } from "@/lib/queue";
import type { ParsedOrder } from "@/lib/parser/types";

/**
 * 处理单个分片 Job
 *
 * Pipeline:
 * 1. 读取任务和解析规则
 * 2. 解析文件 → 提取本分片行
 * 3. 批量校验 SKU（含超时降级）
 * 4. 批量写入 orders + orderItems
 * 5. 记录错误 + 性能日志 + Trace
 * 6. 更新任务进度
 */
export async function processShardJob(
  job: Job<ImportShardJobData>
): Promise<void> {
  const { taskId, shardIndex, startRow, endRow, traceId } = job.data;
  const totalStart = performance.now();

  await addTraceEvent({
    traceId,
    taskId,
    shardIndex,
    eventName: "SHARD_STARTED",
    message: `Shard ${shardIndex}: rows ${startRow}-${endRow}`,
  });

  try {
    // ========== Step 1: 读取任务和规则 ==========
    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, taskId as any));

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!task.fileData) {
      throw new Error(`Task ${taskId} has no file data`);
    }

    // 读取解析规则（如有）
    let steps: any[] = [];
    let fieldMapping: any = null;

    if (task.ruleId) {
      const { parsingRules } = await import("@/lib/db/schema");
      const [rule] = await db
        .select()
        .from(parsingRules)
        .where(eq(parsingRules.id, task.ruleId));
      if (rule) {
        steps = (rule.steps as any[]) || [];
        fieldMapping = rule.fieldMapping || null;
      }
    }

    // ========== Step 2: 解析文件 ==========
    const parseStart = performance.now();
    const rawBuffer = Buffer.from(task.fileData, "base64");
    const fileType = task.fileType || "xlsx";
    const workbook = await preprocessFile(rawBuffer, fileType, task.fileName);

    // 解析全部数据
    let allOrders: ParsedOrder[];
    try {
      const result = await parseFileWithRule(
        workbook as any,
        steps as any,
        fieldMapping
      );
      allOrders = result.orders;
    } catch (parseErr: any) {
      // 降级：使用无规则解析
      addTraceEvent({
        traceId,
        taskId,
        shardIndex,
        eventName: "PARSE_RULE_ERROR",
        eventStatus: "error",
        message: `Rule parse failed: ${parseErr.message}, falling back to raw parse`,
      });

      const { parseFile } = await import("@/lib/parser/engine");
      const rawResult = await parseFile(workbook as any, []);
      allOrders = rawResult.orders;
    }

    const parseDuration = performance.now() - parseStart;

    // 提取本分片的行（rows are 0-indexed in array, 1-indexed in display）
    const shardOrders = allOrders.slice(startRow - 1, endRow);

    if (shardOrders.length === 0) {
      // 空分片：直接标记完成
      await markShardCompleted(taskId, shardIndex, 0, 0, traceId);
      return;
    }

    // ========== Step 3: 批量 SKU 校验 ==========
    let degraded = task.degraded || false;
    let validateDuration = 0;

    if (!degraded) {
      const validateStart = performance.now();

      try {
        // 收集所有 SKU 编码
        const skuCodes: string[] = [];
        for (const order of shardOrders) {
          if (order.items) {
            for (const item of order.items) {
              if (item.skuCode) {
                skuCodes.push(item.skuCode);
              }
            }
          }
        }

        // 去重
        const uniqueSkus = [...new Set(skuCodes)];

        // 无 SKU 则跳过校验
        const validSkuSet = new Set<string>();
        if (uniqueSkus.length > 0) {
          const SKU_QUERY_TIMEOUT = 3000;

          // 使用 Promise.race 实现真正的超时中断
          const queryPromise = db
            .select({ skuCode: skuMaster.skuCode })
            .from(skuMaster)
            .where(inArray(skuMaster.skuCode, uniqueSkus));

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("SKU query timeout")), SKU_QUERY_TIMEOUT)
          );

          const validSkus = await Promise.race([
            queryPromise.then((rows) => rows),
            timeoutPromise,
          ]);

          for (const s of validSkus) {
            validSkuSet.add(s.skuCode);
          }
        }

        validateDuration = performance.now() - validateStart;

        // 校验每个 SKU
        const errors: any[] = [];
        for (const order of shardOrders) {
          if (order.items) {
            for (const item of order.items) {
              if (item.skuCode && validSkuSet.size > 0 && !validSkuSet.has(item.skuCode)) {
                errors.push({
                  taskId,
                  shardIndex,
                  rowNumber: startRow,
                  fieldName: "sku_code",
                  rawValue: item.skuCode,
                  errorCode: "SKU_NOT_FOUND",
                  errorReason: `SKU "${item.skuCode}" not found in master data`,
                  traceId,
                });
              }
            }
          }
        }

        // 写入错误
        if (errors.length > 0) {
          await db.insert(importTaskErrors).values(errors as any);
          addTraceEvent({
            traceId,
            taskId,
            shardIndex,
            eventName: "SKU_VALIDATION_ERRORS",
            eventStatus: "error",
            message: `${errors.length} SKU not found errors`,
            metadata: { errorCount: errors.length },
          });
        }
      } catch (skuErr: any) {
        // SKU 查询超时或异常 → 降级
        degraded = true;
        const reason: "sku_query_timeout" | "sku_query_error" =
          skuErr.message === "SKU query timeout" ? "sku_query_timeout" : "sku_query_error";
        const msg = buildDegradationMessage(reason);
        addTraceEvent({
          traceId,
          taskId,
          shardIndex,
          eventName: "SKU_VALIDATION_DEGRADED",
          eventStatus: "degraded",
          message: `${msg}: ${skuErr.message}`,
        });
        await db
          .update(importTasks)
          .set({ degraded: true } as any)
          .where(eq(importTasks.id, taskId as any));
        console.warn(`[Worker] Task ${taskId} shard ${shardIndex} degraded: ${msg}`);
      }
    }

    // ========== Step 4: 逐行写入订单（失败不阻断） ==========
    const insertStart = performance.now();
    let insertedOrders = 0;
    let insertErrors = 0;
    const insertErrorRecords: any[] = [];

    // 逐行插入，单条失败则记录错误 + 跳过，不阻断分片
    const BATCH_SIZE = 200;
    const orderValues = shardOrders.map((order, idx) => ({
      idx,
      values: {
        externalCode: order.externalCode || null,
        importId: taskId,
        taskId,
        storeName: order.storeName || null,
        receiverName: order.receiverName || null,
        receiverPhone: order.receiverPhone || null,
        receiverAddress: order.receiverAddress || null,
        remark: order.remark || null,
        status: "draft",
        createdAt: new Date(),
      } as any,
      items: order.items || [],
    }));

    const allItemValues: any[] = [];

    for (let i = 0; i < orderValues.length; i += BATCH_SIZE) {
      const batch = orderValues.slice(i, i + BATCH_SIZE);

      for (const { idx, values, items: itemList } of batch) {
        const rowNumber = startRow + idx;
        try {
          const [result] = await db
            .insert(orders)
            .values(values)
            .returning({ id: orders.id });

          const orderId = result.id;
          insertedOrders++;

          // 构建该订单的 orderItems
          itemList.forEach((item: any, itemIdx: number) => {
            allItemValues.push({
              orderId,
              skuCode: item.skuCode || "",
              skuName: item.skuName || "",
              quantity: item.quantity || 1,
              specification: item.specification || null,
              sortOrder: itemIdx + 1,
              lineNo: itemIdx + 1,
            });
          });
        } catch (rowErr: any) {
          insertErrors++;
          insertErrorRecords.push({
            taskId,
            shardIndex,
            rowNumber,
            fieldName: "__order__",
            rawValue: JSON.stringify(values),
            errorCode: "DB_INSERT_ERROR",
            errorReason: `行 ${rowNumber} 写入失败: ${rowErr.message}`,
            traceId,
          });
        }
      }
    }

    // 批量写入 orderItems（只写成功订单的 items）
    if (allItemValues.length > 0) {
      for (let i = 0; i < allItemValues.length; i += BATCH_SIZE) {
        const batch = allItemValues.slice(i, i + BATCH_SIZE);
        try {
          await db.insert(orderItems).values(batch as any);
        } catch (itemErr: any) {
          // orderItems 写入失败：单独记录
          insertErrors++;
          insertErrorRecords.push({
            taskId,
            shardIndex,
            rowNumber: startRow,
            fieldName: "__order_items__",
            rawValue: `batch ${i / BATCH_SIZE}`,
            errorCode: "DB_INSERT_ERROR",
            errorReason: `OrderItems 批量写入失败: ${itemErr.message}`,
            traceId,
          });
        }
      }
    }

    // 记录插入失败的错误明细
    if (insertErrorRecords.length > 0) {
      await db.insert(importTaskErrors).values(insertErrorRecords as any);
      addTraceEvent({
        traceId,
        taskId,
        shardIndex,
        eventName: "INSERT_PARTIAL_ERRORS",
        eventStatus: "error",
        message: `${insertErrors} rows failed during insert, skipped`,
        metadata: { insertErrors, insertedOrders, totalRows: shardOrders.length },
      });
    }

    const insertDuration = performance.now() - insertStart;
    const totalDuration = performance.now() - totalStart;

    // ========== Step 5: 记录性能日志 ==========
    await db.insert(batchPerformanceLog).values([
      {
        taskId,
        shardIndex,
        parseDurationMs: Math.round(parseDuration),
        ruleDurationMs: Math.round(parseDuration), // 解析和规则合并在 parse 阶段
        validateDurationMs: Math.round(validateDuration),
        insertDurationMs: Math.round(insertDuration),
        totalDurationMs: Math.round(totalDuration),
        status: "completed",
        rowCount: shardOrders.length,
        traceId,
      },
    ] as any);

    // ========== Step 6: 标记分片完成 + 更新任务进度 ==========
    await markShardCompleted(taskId, shardIndex, insertedOrders, insertErrors, traceId);

    addTraceEvent({
      traceId,
      taskId,
      shardIndex,
      eventName: "SHARD_COMPLETED",
      message: `Shard ${shardIndex} completed: ${shardOrders.length} rows, ${insertedOrders} orders, ${totalDuration.toFixed(0)}ms`,
      metadata: {
        rowCount: shardOrders.length,
        insertedOrders,
        parseDurationMs: Math.round(parseDuration),
        validateDurationMs: Math.round(validateDuration),
        insertDurationMs: Math.round(insertDuration),
        totalDurationMs: Math.round(totalDuration),
        degraded,
      },
    });

    console.log(
      `[Worker] Shard ${shardIndex} (${taskId}): ${shardOrders.length} rows, ${totalDuration.toFixed(0)}ms, degraded=${degraded}`
    );
  } catch (error: any) {
    const totalDuration = performance.now() - totalStart;
    console.error(
      `[Worker] Shard ${shardIndex} (${taskId}) FAILED: ${error.message}`
    );

    // 标记分片失败
    await db
      .update(importTaskShards)
      .set({
        status: "failed",
        completedAt: new Date(),
      } as any)
      .where(
        sql`${importTaskShards.taskId} = ${taskId} AND ${importTaskShards.shardIndex} = ${shardIndex}`
      );

    addTraceEvent({
      traceId,
      taskId,
      shardIndex,
      eventName: "SHARD_FAILED",
      eventStatus: "error",
      message: error.message,
      metadata: { totalDurationMs: Math.round(totalDuration) },
    });

    throw error; // BullMQ 会处理重试
  }
}

/**
 * 原子标记分片完成 + 更新任务进度
 */
async function markShardCompleted(
  taskId: string,
  shardIndex: number,
  successCount: number,
  failedCount: number,
  traceId: string
): Promise<void> {
  // 更新分片状态
  await db
    .update(importTaskShards)
    .set({
      status: "completed",
      completedAt: new Date(),
    } as any)
    .where(
      sql`${importTaskShards.taskId} = ${taskId} AND ${importTaskShards.shardIndex} = ${shardIndex}`
    );

  const processedCount = successCount + failedCount;

  // 更新任务进度（原子递增）
  await db
    .update(importTasks)
    .set({
      completedShards: sql`completed_shards + 1`,
      processedRows: sql`processed_rows + ${processedCount}`,
      successRows: sql`success_rows + ${successCount}`,
      failedRows: sql`failed_rows + ${failedCount}`,
      updatedAt: new Date(),
    } as any)
    .where(eq(importTasks.id, taskId as any));

  // 检查是否所有分片完成
  const [task] = await db
    .select()
    .from(importTasks)
    .where(eq(importTasks.id, taskId as any));

  if (task && task.completedShards >= task.totalShards) {
    const newStatus = task.degraded ? "degraded" : "completed";
    await db
      .update(importTasks)
      .set({
        status: newStatus,
        completedAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(eq(importTasks.id, taskId as any));

    addTraceEvent({
      traceId,
      taskId,
      eventName: "TASK_COMPLETED",
      message: `Task completed: ${task.completedShards}/${task.totalShards} shards, success=${task.successRows}, failed=${task.failedRows}, status=${newStatus}`,
    });
  }
}

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
  isSkuValidationTimeout,
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
        fieldMapping = rule.fieldMappings || null;
      }
    }

    // ========== Step 2: 解析文件 ==========
    const parseStart = performance.now();
    const rawBuffer = Buffer.from(task.fileData, "base64");
    const fileType = task.fileType || "xlsx";
    // 转换为 ArrayBuffer（preprocessFile 需要）
    const arrayBuffer = rawBuffer.buffer.slice(
      rawBuffer.byteOffset,
      rawBuffer.byteOffset + rawBuffer.byteLength
    ) as ArrayBuffer;
    const workbook = preprocessFile(arrayBuffer as any, fileType, task.fileName);

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
      await markShardCompleted(taskId, shardIndex, traceId);
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

        // 批量查询 sku_master（设置 3s 超时）
        const queryPromise = db
          .select({ skuCode: skuMaster.skuCode })
          .from(skuMaster)
          .where(inArray(skuMaster.skuCode, uniqueSkus));

        // 超时检查
        if (isSkuValidationTimeout(validateStart)) {
          throw new Error("SKU query timeout");
        }

        const validSkus = await queryPromise;
        const elapsed = performance.now() - validateStart;

        if (elapsed >= 3000) {
          // 超时降级
          degraded = true;
          const msg = buildDegradationMessage("sku_query_timeout");
          addTraceEvent({
            traceId,
            taskId,
            shardIndex,
            eventName: "SKU_VALIDATION_DEGRADED",
            eventStatus: "degraded",
            message: msg,
          });

          // 更新任务降级标记
          await db
            .update(importTasks)
            .set({ degraded: true } as any)
            .where(eq(importTasks.id, taskId as any));

          console.warn(`[Worker] Task ${taskId} degraded: ${msg}`);
        }

        const validSkuSet = new Set(validSkus.map((s) => s.skuCode));
        validateDuration = performance.now() - validateStart;

        // 校验每个 SKU
        if (!degraded) {
          const errors: any[] = [];
          for (const order of shardOrders) {
            if (order.items) {
              for (const item of order.items) {
                if (item.skuCode && !validSkuSet.has(item.skuCode)) {
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
        }
      } catch (skuErr: any) {
        // SKU 查询异常 → 降级
        degraded = true;
        const msg = buildDegradationMessage("sku_query_error");
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
      }
    }

    // ========== Step 4: 批量写入订单 ==========
    const insertStart = performance.now();
    let insertedOrders = 0;

    try {
      // 构建 orders 数据
      const orderValues = shardOrders.map((order) => ({
        externalCode: order.externalCode || null,
        importId: taskId, // 使用 task ID 作为 import ID
        taskId,
        storeName: order.storeName || null,
        receiverName: order.receiverName || null,
        receiverPhone: order.receiverPhone || null,
        receiverAddress: order.receiverAddress || null,
        remark: order.remark || null,
        status: "draft",
        createdAt: new Date(),
      }));

      // 批量插入 orders（使用 transaction 分批，避免超长语句）
      const BATCH_SIZE = 200;
      const insertedIds: string[] = [];

      for (let i = 0; i < orderValues.length; i += BATCH_SIZE) {
        const batch = orderValues.slice(i, i + BATCH_SIZE);
        const result = await db
          .insert(orders)
          .values(batch as any)
          .returning({ id: orders.id });
        insertedIds.push(...result.map((r: any) => r.id));
      }

      insertedOrders = insertedIds.length;

      // 构建 orderItems 数据
      const itemValues: any[] = [];
      for (let i = 0; i < shardOrders.length; i++) {
        const order = shardOrders[i];
        const orderId = insertedIds[i];
        if (order.items) {
          order.items.forEach((item, idx) => {
            itemValues.push({
              orderId,
              skuCode: item.skuCode || "",
              skuName: item.skuName || "",
              quantity: item.quantity || 1,
              specification: item.specification || null,
              sortOrder: idx + 1,
              lineNo: idx + 1,
            });
          });
        }
      }

      // 批量插入 orderItems
      if (itemValues.length > 0) {
        for (let i = 0; i < itemValues.length; i += BATCH_SIZE) {
          const batch = itemValues.slice(i, i + BATCH_SIZE);
          await db.insert(orderItems).values(batch as any);
        }
      }
    } catch (insertErr: any) {
      addTraceEvent({
        traceId,
        taskId,
        shardIndex,
        eventName: "INSERT_ERROR",
        eventStatus: "error",
        message: insertErr.message,
      });

      // 写通用错误
      await db.insert(importTaskErrors).values([
        {
          taskId,
          shardIndex,
          rowNumber: startRow,
          errorCode: "DB_INSERT_ERROR",
          errorReason: `Database insert failed: ${insertErr.message}`,
          traceId,
        },
      ] as any);

      throw insertErr;
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
    await markShardCompleted(taskId, shardIndex, traceId);

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

  // 更新任务进度（原子递增 completedShards）
  await db
    .update(importTasks)
    .set({
      completedShards: sql`completed_shards + 1`,
      processedRows: sql`processed_rows + (SELECT row_count FROM batch_performance_log WHERE task_id = ${taskId} AND shard_index = ${shardIndex} ORDER BY created_at DESC LIMIT 1)`,
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
      message: `Task completed: ${task.completedShards}/${task.totalShards} shards, status=${newStatus}`,
    });
  }
}

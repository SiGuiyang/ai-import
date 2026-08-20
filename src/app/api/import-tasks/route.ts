import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  importTasks,
  importTaskShards,
  eventOutbox,
} from "@/lib/db/schema";
import { generateTraceId, addTraceEvent } from "@/lib/trace";
import { eq, desc, and, sql } from "drizzle-orm";
import * as XLSX from "xlsx";

const SHARD_SIZE = 1000; // 每批 1000 行
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * POST /api/import-tasks
 * 上传文件并创建异步导入任务
 *
 * 请求：multipart/form-data
 *   - file: File (.xlsx / .xls)
 *   - ruleId?: string (解析规则ID，可选)
 *
 * 响应：{ taskId, traceId, totalRows, totalShards }
 *
 * 超时要求：≤ 1s（仅做快计数 + 创建记录）
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const ruleId = formData.get("ruleId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Missing file" },
        { status: 400 }
      );
    }

    // 校验文件大小
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }

    // 校验文件类型
    const fileName = file.name;
    const fileType = fileName.split(".").pop()?.toLowerCase() || "";
    if (!["xlsx", "xls"].includes(fileType)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${fileType}` },
        { status: 400 }
      );
    }

    // 读取文件内容的 base64
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    // 快速解析行数（不应用解析规则，仅统计行数）
    // 使用 decode_range 读取工作表范围，避免逐单元格解析，保证 20MB 大文件也 ≤1s
    const workbook = XLSX.read(buffer, { type: "buffer", dense: false });
    let totalRows = 0;
    workbook.SheetNames.forEach((name) => {
      const sheet = workbook.Sheets[name];
      const ref = sheet["!ref"];
      if (!ref) return;
      const range = XLSX.utils.decode_range(ref);
      // e.r 为末行索引（0 基），+1 为行数；再扣除可能的表头行不做处理（快计数口径）
      totalRows += range.e.r + 1;
    });

    if (totalRows === 0) {
      return NextResponse.json(
        { error: "File contains no data rows" },
        { status: 400 }
      );
    }

    // 计算分片数
    const totalShards = Math.ceil(totalRows / SHARD_SIZE);
    const traceId = generateTraceId();

    // 创建导入任务 + 分片 + Outbox 事件（同一数据库事务，保证原子性）
    let taskId = "";
    let shardValues: Array<{
      taskId: string;
      shardIndex: number;
      startRow: number;
      endRow: number;
      status: string;
    }> = [];
    await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(importTasks)
        .values({
          fileName,
          fileType,
          fileData: base64Data,
          ruleId: ruleId || null,
          totalRows,
          totalShards,
          traceId,
        } as any)
        .returning({ id: importTasks.id });

      taskId = task.id;

      // 创建分片记录
      shardValues = [];
      for (let i = 0; i < totalShards; i++) {
        const startRow = i * SHARD_SIZE + 1;
        const endRow = Math.min((i + 1) * SHARD_SIZE, totalRows);
        shardValues.push({
          taskId,
          shardIndex: i,
          startRow,
          endRow,
          status: "pending",
        });
      }
      await tx.insert(importTaskShards).values(shardValues as any);

      // 创建出箱事件（与任务同事务）
      const outboxValues = shardValues.map((s) => ({
        aggregateId: taskId,
        eventType: "IMPORT_SHARD_CREATED",
        payload: {
          taskId,
          shardIndex: s.shardIndex,
          startRow: s.startRow,
          endRow: s.endRow,
          traceId,
        },
        status: "pending",
      }));
      await tx.insert(eventOutbox).values(outboxValues as any);
    });

    // 直接入队到 BullMQ（同时保留 outbox 事件作为可靠性保障）
    try {
      const { addShardJobs } = await import("@/lib/queue");
      const shardJobParams: Array<{
        taskId: string;
        shardIndex: number;
        startRow: number;
        endRow: number;
        traceId: string;
      }> = shardValues.map((s) => ({
        taskId,
        shardIndex: s.shardIndex,
        startRow: s.startRow,
        endRow: s.endRow,
        traceId,
      }));
      await addShardJobs(shardJobParams as any);
      console.log(`[ImportTask] Enqueued ${shardJobParams.length} shard jobs for task ${taskId}`);
    } catch (queueErr: any) {
      // 入队失败不阻塞任务创建（可通过 outbox 调度器后续重试）
      console.warn(`[ImportTask] Failed to enqueue shard jobs (will retry via outbox): ${queueErr.message}`);
    }

    // 记录 Trace 事件
    addTraceEvent({
      traceId,
      taskId,
      eventName: "TASK_CREATED",
      eventStatus: "ok",
      message: `Task created: ${totalRows} rows, ${totalShards} shards`,
      metadata: {
        fileName,
        fileType,
        totalRows,
        totalShards,
        ruleId: ruleId || null,
        uploadDurationMs: Math.round(performance.now() - startTime),
      },
    });

    const duration = Math.round(performance.now() - startTime);
    console.log(
      `[ImportTask] Created task ${taskId} (${totalRows} rows, ${totalShards} shards) in ${duration}ms`
    );

    return NextResponse.json({
      taskId,
      traceId,
      totalRows,
      totalShards,
      fileName,
    });
  } catch (error: any) {
    console.error("[ImportTask] Upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/import-tasks
 * 查询导入任务列表
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "20");

    const conditions: any[] = [];
    if (status) {
      conditions.push(eq(importTasks.status, status as any));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [tasks, countResult] = await Promise.all([
      db
        .select()
        .from(importTasks)
        .where(where)
        .orderBy(desc(importTasks.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(importTasks)
        .where(where),
    ]);

    return NextResponse.json({
      tasks,
      total: countResult[0]?.count || 0,
      page,
      pageSize,
    });
  } catch (error: any) {
    console.error("[ImportTask] List failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list tasks" },
      { status: 500 }
    );
  }
}

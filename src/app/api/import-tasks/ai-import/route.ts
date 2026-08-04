/**
 * POST /api/import-tasks/ai-import
 *
 * 模块十恢复：AI 智能解析 → 直接创建导入任务
 *
 * 接收 AI 已解析的结构化数据 + 源文件元信息 → 写入 raw_data + Outbox → 返回 taskId
 * 与规则引擎路径共享同一套异步 Worker 管道，但 raw_data 已经是目标格式，
 * Worker 在处理时会识别 importMode='ai-direct' 跳过规则引擎步骤。
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { initDB, getSql } from '@/lib/db';
import { generateTraceId, generateTaskId, generateUnitId, logTraceEvent } from '@/lib/trace';

const BATCH_SIZE = 1000;

export async function POST(req: NextRequest) {
  const traceId = generateTraceId();
  const startedAt = Date.now();

  try {
    const body = await req.json();
    const { data, fileName, fileType } = body;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: '请提供有效的解析数据' }, { status: 400 });
    }

    const totalRows = data.length;
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);
    const taskId = generateTaskId();

    // 内容哈希（基于 JSON 字符串，用于去重）
    const contentHash = createHash('sha256')
      .update(JSON.stringify(data).slice(0, 100000))
      .digest('hex');

    // 生成批次
    const batches: Array<{
      id: string; unitId: string; batchIndex: number;
      startRow: number; endRow: number;
    }> = [];
    for (let i = 0; i < totalBatches; i++) {
      batches.push({
        id: uuidv4(),
        unitId: generateUnitId(i),
        batchIndex: i,
        startRow: i * BATCH_SIZE + 1,
        endRow: Math.min((i + 1) * BATCH_SIZE, totalRows),
      });
    }

    await initDB();
    const sql = await getSql();

    // 事务写入
    const queries: any[] = [];

    // 1. 创建任务
    queries.push(sql`
      INSERT INTO import_tasks
        (id, file_name, file_url, rule_id, status, total_rows,
         total_batches, trace_id, content_hash)
      VALUES
        (${taskId}, ${fileName || 'AI-解析数据'}, ${''}, ${'ai-direct'},
         'PENDING', ${totalRows}, ${totalBatches}, ${traceId}, ${contentHash})
    `);

    // 2. 写入原始数据（AI 已解析为结构化格式，字段即为 targetField）
    const rawDataBatchSize = 500;
    for (let offset = 0; offset < totalRows; offset += rawDataBatchSize) {
      const chunk = data.slice(offset, offset + rawDataBatchSize);
      const values: string[] = [];
      const params: any[] = [];
      let pi = 1;
      for (let j = 0; j < chunk.length; j++) {
        const rowIdx = offset + j;
        values.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        params.push(uuidv4(), taskId, rowIdx, JSON.stringify(chunk[j]));
      }
      queries.push(
        sql.raw(
          `INSERT INTO import_task_raw_data (id, task_id, row_index, raw_data) VALUES ${values.join(', ')}`,
          params
        )
      );
    }

    // 3. 写入 Outbox（标记 ai-direct 模式）
    for (const b of batches) {
      const outboxId = uuidv4();
      const eventPayload = JSON.stringify({
        taskId,
        unitId: b.unitId,
        batchIndex: b.batchIndex,
        startRow: b.startRow,
        endRow: b.endRow,
        fileName: fileName || 'AI-解析数据',
        fileUrl: '',
        importMode: 'ai-direct',
        rule: {},
        traceId,
      });

      queries.push(sql`
        INSERT INTO event_outbox
          (id, aggregate_id, event_type, payload, status, next_retry_at)
        VALUES
          (${outboxId}, ${taskId}, 'ImportBatchCreated',
           ${eventPayload}::jsonb, 'PENDING', NOW())
      `);
    }

    // 4. 写入批次状态记录
    for (const b of batches) {
      queries.push(sql`
        INSERT INTO import_task_batches
          (id, task_id, unit_id, batch_index, start_row, end_row, status, trace_id)
        VALUES
          (${b.id}, ${taskId}, ${b.unitId}, ${b.batchIndex},
           ${b.startRow}, ${b.endRow}, 'PENDING', ${traceId})
      `);
    }

    await sql.unsafe(queries.map((q: any) => q.text).join(';\n') + ';',
      queries.flatMap((q: any) => q.values || []));

    // 记录 Trace 事件
    await logTraceEvent({
      traceId, taskId,
      eventName: 'TaskCreated',
      eventStatus: 'STARTED',
      message: `AI 直接解析任务创建: ${totalRows} 行, ${totalBatches} 批`,
    });

    const cost = Date.now() - startedAt;
    console.log(`[AI-Import] taskId=${taskId} rows=${totalRows} batches=${totalBatches} cost=${cost}ms`);

    return NextResponse.json({
      taskId,
      traceId,
      status: 'PENDING',
      totalRows,
      totalBatches,
      fileName: fileName || 'AI-解析数据',
    });
  } catch (e) {
    console.error('[AI-Import] 创建任务失败:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/import-tasks
 *
 * 上传文件 + 解析规则 → 文件哈希去重 → 创建异步导入任务 → 写入 Outbox → 立即返回 task_id
 *
 * 请求：multipart/form-data
 *   file - Excel/Word/PDF 文件（必填）
 *   rule - JSON 字符串，解析规则（必填）
 *
 * 响应：{ taskId, traceId, status: "PENDING", totalRows, totalBatches, duplicate, originalTaskId? }
 *
 * 去重策略：SHA-256 文件哈希，24h 内相同哈希视为重复，返回已有 task_id
 * P95 ≤ 1 秒返回
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { initDB, getSql, sqlTransaction } from '@/lib/db';
import { generateTraceId, generateTaskId, generateUnitId, logTraceEvent } from '@/lib/trace';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import type { ImportTaskStatus } from '@/lib/types';

// 处理单元大小（每批行数）
const BATCH_SIZE = 1000;

// 去重窗口：24 小时
const DEDUP_WINDOW_HOURS = 24;

/**
 * 计算文件的 SHA-256 哈希值
 */
function computeFileHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 检查相同哈希文件是否在去重窗口内已被上传
 * 返回原有任务 ID 或 null
 */
async function checkDuplicate(hash: string): Promise<{ id: string; fileName: string } | null> {
  try {
    const sql = await getSql();
    const rows = await sql`
      SELECT id, file_name
      FROM import_tasks
      WHERE content_hash = ${hash}
        AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW_HOURS} hours'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length > 0) {
      return { id: String(rows[0].id), fileName: String(rows[0].file_name) };
    }
  } catch {
    // 去重失败不阻塞上传
  }
  return null;
}

/**
 * 从 buffer 解析文件并返回原始行数据 + 行数
 * （复用已读取的二进制数据，避免二次读取 File）
 */
async function parseFileFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const nameLower = fileName.toLowerCase();

  if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer', bookSheets: true });
      const allRows: Record<string, unknown>[] = [];
      let headers: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
        if (data.length === 0) continue;

        headers = data[0].map((h: string) => String(h).trim());
        for (let i = 1; i < data.length; i++) {
          const row: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            row[h] = data[i][idx] ?? '';
          });
          allRows.push(row);
        }
      }
      return { rows: allRows, headers };
    } catch {
      return { rows: [], headers: [] };
    }
  }

  if (nameLower.endsWith('.docx')) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value;
      const lines = text.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return { rows: [], headers: [] };

      const headers = lines[0].split(/\t|\s{2,}/);
      const dataRows: Record<string, unknown>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/\t|\s{2,}/);
        if (cols.length > 1) {
          const row: Record<string, unknown> = {};
          headers.forEach((h, idx) => {
            row[h] = cols[idx] ?? '';
          });
          dataRows.push(row);
        }
      }
      return { rows: dataRows, headers };
    } catch {
      return { rows: [], headers: [] };
    }
  }

  // E008: 不支持的文件格式
  throw new Error(`E008:不支持的文件格式 "${fileName}"，请上传 .xlsx、.xls 或 .docx 文件`);
}

/**
 * POST /api/import-tasks
 */
export async function POST(req: NextRequest) {
  const traceId = generateTraceId();
  const startedAt = Date.now();

  try {
    // 1. 解析 multipart
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const ruleJson = formData.get('rule') as string | null;

    if (!file) {
      return NextResponse.json(
        { code: 400, message: '请上传文件' },
        { status: 400 }
      );
    }

    if (!ruleJson) {
      return NextResponse.json(
        { code: 400, message: '请提供解析规则' },
        { status: 400 }
      );
    }

    let rule: Record<string, unknown>;
    try {
      rule = JSON.parse(ruleJson);
    } catch {
      return NextResponse.json(
        { code: 400, message: '解析规则 JSON 格式错误' },
        { status: 400 }
      );
    }

    const fileName = file.name;

    // 2. 计算文件 SHA-256 哈希（用于去重）
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const contentHash = computeFileHash(fileBuffer);

    // 3. 去重检查：24h 内相同哈希 → 返回已有 taskId
    const duplicate = await checkDuplicate(contentHash);
    if (duplicate) {
      const cost = Date.now() - startedAt;
      console.log(`[ImportTask] DUPLICATE hash=${contentHash.slice(0,12)} existingTaskId=${duplicate.id} cost=${cost}ms`);

      await logTraceEvent({
        traceId,
        eventName: 'DuplicateUploadDetected',
        eventStatus: 'STARTED',
        message: `文件哈希匹配已有任务 ${duplicate.id}: ${duplicate.fileName}`,
      });

      return NextResponse.json({
        taskId: duplicate.id,
        traceId,
        status: 'DUPLICATE',
        message: `该文件在 ${DEDUP_WINDOW_HOURS}h 内已上传（任务: ${duplicate.id}），请前往查看进度`,
      });
    }

    // 4. 快速解析文件（从刚才读到的 buffer 复用）
    //      需要重新包成 File 对象或直接用 buffer 解析
    const { rows: parsedRows } = await parseFileFromBuffer(fileBuffer, file.name);
    const totalRows = parsedRows.length;

    if (totalRows === 0) {
      return NextResponse.json(
        { code: 400, message: '文件内容为空或无法识别格式' },
        { status: 400 }
      );
    }

    // 5. 分批：计算处理单元数
    const totalBatches = Math.ceil(totalRows / BATCH_SIZE);

    // 6. 生成处理单元
    const batches: Array<{
      id: string;
      unitId: string;
      batchIndex: number;
      startRow: number;
      endRow: number;
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

    // 文件引用路径（生产环境应使用 S3/OSS 预签名 URL）
    const taskId = generateTaskId();
    const fileUrl = `/uploads/${taskId}_${fileName}`;

    // 7. 数据库事务：任务 + Outbox + 处理单元 + 原始数据（全或无）
    await initDB();
    const sql = await getSql();

    try {
      // 构建事务查询数组（所有查询在同一个 BEGIN/COMMIT 中执行）
      const queries: any[] = [];

      // 7a. 创建任务记录（含 content_hash）
      queries.push(sql`
        INSERT INTO import_tasks
          (id, file_name, file_url, rule_id, status, total_rows,
           total_batches, trace_id, content_hash)
        VALUES
          (${taskId}, ${fileName}, ${fileUrl}, ${rule.id || 'default'},
           'PENDING', ${totalRows}, ${totalBatches}, ${traceId}, ${contentHash})
      `);

      // 7b. 写入原始数据（批量插入，每批 500 行，使用 sql.raw）
      const rawDataBatchSize = 500;
      for (let offset = 0; offset < parsedRows.length; offset += rawDataBatchSize) {
        const chunk = parsedRows.slice(offset, offset + rawDataBatchSize);
        const values: string[] = [];
        const params: any[] = [];
        let pi = 1;
        for (let j = 0; j < chunk.length; j++) {
          const rowIdx = offset + j;
          values.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++})`);
          params.push(
            uuidv4(),
            taskId,
            rowIdx,
            JSON.stringify(chunk[j])
          );
        }
        queries.push(
          sql.raw(
            `INSERT INTO import_task_raw_data (id, task_id, row_index, raw_data) VALUES ${values.join(', ')}`,
            params
          )
        );
      }

      // 7c. 写入 Outbox 事件（一个批次一个事件）
      for (const b of batches) {
        const outboxId = uuidv4();
        const eventPayload = JSON.stringify({
          taskId,
          unitId: b.unitId,
          batchIndex: b.batchIndex,
          startRow: b.startRow,
          endRow: b.endRow,
          fileName,
          fileUrl,
          rule,
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

      // 7d. 写入处理单元状态记录
      for (const b of batches) {
        queries.push(sql`
          INSERT INTO import_task_batches
            (id, task_id, unit_id, batch_index, start_row, end_row,
             status, trace_id)
          VALUES
            (${b.id}, ${taskId}, ${b.unitId}, ${b.batchIndex},
             ${b.startRow}, ${b.endRow}, 'PENDING', ${traceId})
        `);
      }

      // 执行事务：所有操作成功提交，任一失败则回滚
      await sqlTransaction(queries);

    } catch (dbError) {
      await logTraceEvent({
        traceId,
        taskId,
        eventName: 'TaskCreationFailed',
        eventStatus: 'FAILED',
        message: String(dbError).slice(0, 200),
      });

      return NextResponse.json(
        { code: 500, message: `数据库写入异常（Trace: ${traceId.slice(0, 8)}），请稍后重试` },
        { status: 500 }
      );
    }

    // 8. 记录 Trace
    await logTraceEvent({
      traceId,
      taskId,
      eventName: 'ImportTaskCreated',
      eventStatus: 'STARTED',
      message: `文件: ${fileName}, 总行数: ${totalRows}, 批次: ${totalBatches}`,
    });

    // 7. 立即返回（P95 ≤ 1秒），然后异步触发 dispatch
    const cost = Date.now() - startedAt;
    console.log(`[ImportTask] taskId=${taskId} traceId=${traceId} totalRows=${totalRows} batches=${totalBatches} cost=${cost}ms`);

    // 异步触发分发（fire-and-forget，不阻塞响应）
    const dispatchUrl = new URL('/api/import-tasks/dispatch', req.url).toString();
    fetch(dispatchUrl, { method: 'POST' }).catch((err) =>
      console.warn(`[ImportTask] dispatch trigger failed for ${taskId}:`, err)
    );

    return NextResponse.json({
      taskId,
      traceId,
      status: 'PENDING' as ImportTaskStatus,
      totalRows,
      totalBatches,
    });
  } catch (e) {
    const errMsg = String(e);
    await logTraceEvent({
      traceId,
      eventName: 'UploadFailed',
      eventStatus: 'FAILED',
      message: errMsg.slice(0, 200),
    });

    // E008: 文件格式不支持 → 返回 400，附带修复建议
    if (errMsg.startsWith('E008:')) {
      return NextResponse.json(
        {
          code: 400,
          message: errMsg.replace('E008:', ''),
          errorCode: 'E008',
          errorName: '文件格式不支持',
          suggestedFix: '请上传 .xlsx、.xls 或 .docx 格式的文件',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { code: 500, message: `上传处理失败: ${errMsg.slice(0, 200)}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/import-tasks
 * 查询所有导入任务列表
 */
export async function GET(req: NextRequest) {
  try {
    await initDB();
    const sql = await getSql();

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '20'), 50);
    const status = url.searchParams.get('status') || '';
    const offset = (page - 1) * pageSize;

    let tasks: any[] = [];
    try {
      if (status) {
        tasks = await sql`
          SELECT * FROM import_tasks WHERE status = ${status}
          ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
        `;
      } else {
        tasks = await sql`
          SELECT * FROM import_tasks
          ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
        `;
      }
    } catch {
      tasks = [];
    }

    return NextResponse.json({
      code: 0,
      data: tasks.map((t) => ({
        taskId: t.id,
        fileName: t.file_name,
        status: t.status,
        totalRows: t.total_rows,
        processedRows: t.processed_rows,
        successRows: t.success_rows,
        failedRows: t.failed_rows,
        totalBatches: t.total_batches,
        completedBatches: t.completed_batches,
        traceId: t.trace_id,
        degraded: t.degraded,
        createdAt: t.created_at,
        completedAt: t.completed_at,
      })),
      page,
      pageSize,
    });
  } catch (e) {
    return NextResponse.json(
      { code: 500, message: String(e) },
      { status: 500 }
    );
  }
}

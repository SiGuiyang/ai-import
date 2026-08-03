/**
 * 导入 Worker 处理引擎
 *
 * 处理单个处理单元（batch/shard）：
 * 1. 读取原始数据
 * 2. 应用 V2 规则引擎
 * 3. 批量 SKU 校验
 * 4. 格式校验
 * 5. 批量 UPSERT
 * 6. 错误记录 + 性能日志
 */

import { v4 as uuidv4 } from 'uuid';
import { getSql } from '@/lib/db';
import { logTraceEvent } from '@/lib/trace';
import { ERROR_CODES } from '@/lib/types';

// ============ 类型定义 ============

interface BatchJob {
  taskId: string;
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
  fileName: string;
  fileUrl: string;
  rule: Record<string, unknown>;
  traceId: string;
}

interface ParsedRow {
  rowIndex: number;
  data: Record<string, unknown>;
}

interface BatchResult {
  success: number;
  failed: number;
  errors: Array<{
    taskId: string;
    unitId: string;
    batchIndex: number;
    rowNumber: number;
    fieldName: string;
    rawValue: string;
    errorCode: string;
    errorReason: string;
  }>;
  timings: {
    parseDurationMs: number;
    ruleDurationMs: number;
    validateDurationMs: number;
    insertDurationMs: number;
    totalDurationMs: number;
  };
}

// ============ 核心处理函数 ============

/**
 * 处理单个批次 Job
 * 此函数可被 Dispatcher 调用，幂等处理
 */
export async function processBatchJob(job: BatchJob): Promise<BatchResult> {
  const overallStart = Date.now();
  const { taskId, unitId, batchIndex, startRow, endRow, rule, traceId } = job;

  await logTraceEvent({
    traceId, taskId, unitId,
    eventName: 'ImportBatchStarted',
    eventStatus: 'STARTED',
    message: `batch ${batchIndex}: rows ${startRow}-${endRow}`,
  });

  // 1. 幂等检查：如果处理单元已完成，直接返回
  const alreadyDone = await checkBatchCompleted(taskId, unitId);
  if (alreadyDone) {
    console.log(`[Worker] batch ${batchIndex} already completed, skipping`);
    return {
      success: 0, failed: 0, errors: [],
      timings: { parseDurationMs: 0, ruleDurationMs: 0, validateDurationMs: 0, insertDurationMs: 0, totalDurationMs: 0 },
    };
  }

  // 2. 锁定处理单元
  const locked = await lockBatch(taskId, unitId);
  if (!locked) {
    console.warn(`[Worker] batch ${batchIndex} locked by another worker, skipping`);
    return {
      success: 0, failed: 0, errors: [],
      timings: { parseDurationMs: 0, ruleDurationMs: 0, validateDurationMs: 0, insertDurationMs: 0, totalDurationMs: 0 },
    };
  }

  const result: BatchResult = {
    success: 0,
    failed: 0,
    errors: [],
    timings: { parseDurationMs: 0, ruleDurationMs: 0, validateDurationMs: 0, insertDurationMs: 0, totalDurationMs: 0 },
  };

  try {
    // === 阶段 1：解析原始数据 ===
    const parseStart = Date.now();
    const rawRows = await readRawData(taskId, startRow, endRow);
    result.timings.parseDurationMs = Date.now() - parseStart;

    if (rawRows.length === 0) {
      throw new Error(`batch ${batchIndex}: no raw data found for rows ${startRow}-${endRow}`);
    }

    // === 阶段 2：规则引擎 (复用 V2) ===
    const ruleStart = Date.now();
    const parsedRows = await applyRules(rawRows, rule);
    result.timings.ruleDurationMs = Date.now() - ruleStart;

    // === 阶段 3：批量校验 ===
    const validateStart = Date.now();
    const { validRows, errors: validationErrors } = await batchValidate(
      parsedRows, taskId, unitId, batchIndex, traceId
    );
    result.errors.push(...validationErrors);
    result.timings.validateDurationMs = Date.now() - validateStart;

    // === 阶段 4：批量写入 ===
    const insertStart = Date.now();
    const { successCount, failCount, writeErrors } = await batchUpsert(
      validRows, taskId, unitId, batchIndex, traceId
    );
    result.errors.push(...writeErrors);
    result.success = successCount;
    result.failed = failCount + validationErrors.length;
    result.timings.insertDurationMs = Date.now() - insertStart;
    result.timings.totalDurationMs = Date.now() - overallStart;

    // === 写性能日志 ===
    await writePerformanceLog(taskId, unitId, batchIndex, result.timings, traceId,
      result.failed === 0 ? 'SUCCEEDED' : 'SUCCEEDED');

    // === 写错误明细 ===
    await writeErrors(taskId, unitId, batchIndex, result.errors);
    result.timings.totalDurationMs = Date.now() - overallStart; // recalc with error write

    // === 标记批次完成 ===
    await completeBatch(taskId, unitId, result.success, result.failed);

    // === 更新任务进度 ===
    await updateTaskProgress(taskId, unitId, result.success, result.failed);

    // === 检查任务是否全部完成 ===
    await checkAndCompleteTask(taskId);

    await logTraceEvent({
      traceId, taskId, unitId,
      eventName: 'ImportBatchSucceeded',
      eventStatus: 'SUCCEEDED',
      message: `ok=${result.success} fail=${result.failed}`,
    });
  } catch (e) {
    // 处理失败
    result.timings.totalDurationMs = Date.now() - overallStart;
    await failBatch(taskId, unitId, String(e));
    await writePerformanceLog(taskId, unitId, batchIndex, result.timings, traceId, 'FAILED');

    await logTraceEvent({
      traceId, taskId, unitId,
      eventName: 'ImportBatchFailed',
      eventStatus: 'FAILED',
      message: String(e).slice(0, 200),
    });
  }

  return result;
}

// ============ 内部函数 ============

/** 读取原始数据 */
async function readRawData(taskId: string, startRow: number, endRow: number): Promise<ParsedRow[]> {
  const sql = await getSql();
  try {
    const rows = await sql`
      SELECT row_index, raw_data FROM import_task_raw_data
      WHERE task_id = ${taskId}
        AND row_index >= ${startRow - 1}
        AND row_index < ${endRow}
      ORDER BY row_index
    `;
    return rows.map((r: any) => ({
      rowIndex: r.row_index + 1, // 转为 1-based
      data: typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data,
    }));
  } catch {
    return [];
  }
}

/** 应用 V2 规则引擎 */
async function applyRules(
  rawRows: ParsedRow[],
  rule: Record<string, unknown>
): Promise<Array<{ rowIndex: number; data: Record<string, unknown>; error?: string }>> {
  const results: Array<{ rowIndex: number; data: Record<string, unknown>; error?: string }> = [];

  const fieldMapping = (rule.fieldMapping || rule.fields || {}) as Record<string, string>;
  const defaults = (rule.defaults || {}) as Record<string, unknown>;

  for (const raw of rawRows) {
    const mapped: Record<string, unknown> = { ...defaults };

    // 映射字段
    for (const [key, sourceCol] of Object.entries(fieldMapping)) {
      const colIndex = typeof sourceCol === 'string' ? parseInt(sourceCol) : sourceCol;
      if (typeof colIndex === 'number' && !isNaN(colIndex)) {
        // 数字索引 -> 按列位置映射
        const values = Object.values(raw.data);
        if (colIndex < values.length) {
          mapped[key] = values[colIndex];
        }
      } else if (typeof sourceCol === 'string') {
        // 字符串 -> 按列名映射
        if (sourceCol in raw.data) {
          mapped[key] = raw.data[sourceCol];
        }
      }
    }

    // 如果字段映射中没有的列，保留原始列名
    if (Object.keys(fieldMapping).length === 0) {
      Object.assign(mapped, raw.data);
    }

    results.push({ rowIndex: raw.rowIndex, data: mapped });
  }

  return results;
}

/** 批量校验 SKU 和字段 */
async function batchValidate(
  rows: Array<{ rowIndex: number; data: Record<string, unknown>; error?: string }>,
  taskId: string,
  unitId: string,
  batchIndex: number,
  traceId: string,
): Promise<{
  validRows: Array<{ rowIndex: number; data: Record<string, unknown> }>;
  errors: BatchResult['errors'];
}> {
  const errors: BatchResult['errors'] = [];
  const validRows: Array<{ rowIndex: number; data: Record<string, unknown> }> = [];

  // 1. 收集所有 SKU 编码
  const skuCodes: string[] = [];
  const rowSkuMap = new Map<number, string>();

  for (const row of rows) {
    const skuCode = String(row.data.skuCode || row.data.SKU编码 || row.data.sku_code || '').trim();
    if (skuCode) {
      skuCodes.push(skuCode);
      rowSkuMap.set(row.rowIndex, skuCode);
    }
  }

  // 2. 批量查询 SKU 主数据
  const existingSkus = new Set<string>();
  if (skuCodes.length > 0) {
    try {
      const sql = await getSql();
      const results = await sql`
        SELECT sku_code FROM sku_master WHERE sku_code = ANY(${skuCodes})
      `;
      for (const r of results) {
        existingSkus.add(r.sku_code);
      }
    } catch {
      // SKU 主数据查询失败，进入降级模式
      console.warn(`[Worker] batch ${batchIndex}: SKU master query failed, degraded`);
      await markTaskDegraded(taskId, 'SKU 主数据查询失败，跳过 SKU 校验');
      // 降级：所有 SKU 视为有效
      for (const code of skuCodes) {
        existingSkus.add(code);
      }
    }
  }

  // 3. 逐行校验
  for (const row of rows) {
    const d = row.data;
    const rn = row.rowIndex;

    // E001: SKU 不存在
    const skuCode = String(d.skuCode || d.SKU编码 || d.sku_code || '').trim();
    if (skuCode && !existingSkus.has(skuCode)) {
      errors.push({
        taskId, unitId, batchIndex,
        rowNumber: rn,
        fieldName: 'skuCode',
        rawValue: skuCode,
        errorCode: 'E001',
        errorReason: `SKU "${skuCode}" 在主数据中不存在`,
      });
      continue;
    }

    // E002: 必填字段缺失
    if (!skuCode) {
      errors.push({
        taskId, unitId, batchIndex,
        rowNumber: rn,
        fieldName: 'skuCode',
        rawValue: '',
        errorCode: 'E002',
        errorReason: 'SKU 编码为必填项',
      });
      continue;
    }

    // E003: 电话格式
    const phone = String(d.receiverPhone || d.收货电话 || d.receiver_phone || '').trim();
    if (phone) {
      const phoneRegex = /^1[3-9]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        errors.push({
          taskId, unitId, batchIndex,
          rowNumber: rn,
          fieldName: 'receiverPhone',
          rawValue: maskSensitive(phone),
          errorCode: 'E003',
          errorReason: `电话格式错误: ${maskSensitive(phone)}`,
        });
        continue;
      }
    }

    // E004: 数量正数
    const qty = Number(d.skuQuantity || d.数量 || d.sku_quantity || 0);
    if (qty <= 0) {
      errors.push({
        taskId, unitId, batchIndex,
        rowNumber: rn,
        fieldName: 'skuQuantity',
        rawValue: String(d.skuQuantity || d.数量 || ''),
        errorCode: 'E004',
        errorReason: `数量必须为正数，当前值: ${d.skuQuantity || d.数量}`,
      });
      continue;
    }

    validRows.push(row);
  }

  return { validRows, errors };
}

/** 批量写入运单数据 */
async function batchUpsert(
  rows: Array<{ rowIndex: number; data: Record<string, unknown> }>,
  taskId: string,
  unitId: string,
  batchIndex: number,
  traceId: string,
): Promise<{
  successCount: number;
  failCount: number;
  writeErrors: BatchResult['errors'];
}> {
  const errors: BatchResult['errors'] = [];
  let successCount = 0;
  let failCount = 0;

  if (rows.length === 0) return { successCount, failCount, writeErrors: errors };

  try {
    const sql = await getSql();
    const now = new Date().toISOString();

    // 构建批量 INSERT
    const values: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const row of rows) {
      const d = row.data;
      const rn = row.rowIndex;

      try {
        values.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        params.push(
          uuidv4(),
          String(d.externalCode || d.出库单号 || d.external_code || `AUTO_${taskId}_${rn}`),
          String(d.receiverStore || d.收货门店 || d.receiver_store || ''),
          String(d.receiverName || d.收货人 || d.receiver_name || ''),
          String(d.receiverPhone || d.收货电话 || d.receiver_phone || ''),
          String(d.receiverAddress || d.收货地址 || d.receiver_address || ''),
          String(d.skuCode || d.SKU编码 || d.sku_code || ''),
          String(d.skuName || d.SKU名称 || d.sku_name || ''),
          Number(d.skuQuantity || d.数量 || d.sku_quantity || 1),
          String(d.skuSpec || d.规格 || d.sku_spec || ''),
          String(d.remark || d.备注 || d.remark || ''),
        );
        successCount++;
      } catch (rowErr) {
        errors.push({
          taskId, unitId, batchIndex,
          rowNumber: rn,
          fieldName: 'row',
          rawValue: String(d.externalCode || d.出库单号 || ''),
          errorCode: 'E007',
          errorReason: `行数据序列化失败: ${String(rowErr)}`,
        });
        failCount++;
      }
    }

    if (values.length > 0) {
      const query = `
        INSERT INTO orders
          (id, external_code, receiver_store, receiver_name, receiver_phone,
           receiver_address, sku_code, sku_name, sku_quantity, sku_spec, remark)
        VALUES ${values.join(', ')}
        ON CONFLICT DO NOTHING
      `;

      try {
        await sql.raw(query, params);
      } catch (dbErr) {
        // E007: 批量写入失败
        for (const row of rows) {
          errors.push({
            taskId, unitId, batchIndex,
            rowNumber: row.rowIndex,
            fieldName: 'db',
            rawValue: '',
            errorCode: 'E007',
            errorReason: `数据库批量写入失败: ${String(dbErr).slice(0, 100)}`,
          });
        }
        return { successCount: 0, failCount: rows.length, writeErrors: errors };
      }
    }
  } catch (e) {
    for (const row of rows) {
      errors.push({
        taskId, unitId, batchIndex,
        rowNumber: row.rowIndex,
        fieldName: 'db',
        rawValue: '',
        errorCode: 'E007',
        errorReason: `数据库写入异常: ${String(e).slice(0, 100)}`,
      });
    }
    return { successCount: 0, failCount: rows.length, writeErrors: errors };
  }

  return { successCount, failCount, writeErrors: errors };
}

// ============ 数据库操作 ============

async function checkBatchCompleted(taskId: string, unitId: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql`
      SELECT status FROM import_task_batches
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
    `;
    return rows.length > 0 && (rows[0].status === 'SUCCEEDED' || rows[0].status === 'FAILED');
  } catch {
    return false;
  }
}

async function lockBatch(taskId: string, unitId: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const result = await sql`
      UPDATE import_task_batches
      SET status = 'PROCESSING', locked_at = NOW()
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
        AND status = 'QUEUED'
      RETURNING id
    `;
    return result.length > 0;
  } catch {
    return false;
  }
}

async function completeBatch(taskId: string, unitId: string, success: number, failed: number): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_task_batches
      SET status = 'SUCCEEDED', completed_at = NOW()
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
    `;
  } catch { /* ignore */ }
}

async function failBatch(taskId: string, unitId: string, reason: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_task_batches
      SET status = 'FAILED', completed_at = NOW()
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
    `;
  } catch { /* ignore */ }
}

async function updateTaskProgress(
  taskId: string, unitId: string, success: number, failed: number
): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_tasks
      SET
        processed_rows = processed_rows + ${success + failed},
        success_rows = success_rows + ${success},
        failed_rows = failed_rows + ${failed},
        completed_batches = completed_batches + 1,
        status = 'PROCESSING'
      WHERE id = ${taskId}
    `;
  } catch { /* ignore */ }
}

async function checkAndCompleteTask(taskId: string): Promise<void> {
  try {
    const sql = await getSql();
    const task = await sql`SELECT * FROM import_tasks WHERE id = ${taskId}`;
    if (task.length === 0) return;

    const t = task[0];
    if (t.completed_batches >= t.total_batches) {
      const newStatus = t.failed_rows > 0 ? 'PARTIAL_SUCCESS' : 'COMPLETED';

      await sql`
        UPDATE import_tasks
        SET status = ${newStatus}, completed_at = NOW()
        WHERE id = ${taskId}
      `;

      const { logTraceEvent } = await import('@/lib/trace');
      await logTraceEvent({
        traceId: t.trace_id, taskId,
        eventName: t.failed_rows > 0 ? 'ImportTaskPartialSuccess' : 'ImportTaskCompleted',
        eventStatus: 'SUCCEEDED',
        message: `ok=${t.success_rows} fail=${t.failed_rows}`,
      });
    }
  } catch { /* ignore */ }
}

async function markTaskDegraded(taskId: string, reason: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_tasks
      SET degraded = true, degraded_reason = ${reason}
      WHERE id = ${taskId}
    `;

    const task = await sql`SELECT trace_id FROM import_tasks WHERE id = ${taskId}`;
    if (task.length > 0) {
      await logTraceEvent({
        traceId: task[0].trace_id, taskId,
        eventName: 'ImportTaskDegraded',
        eventStatus: 'FAILED',
        message: reason,
      });
    }
  } catch { /* ignore */ }
}

async function writePerformanceLog(
  taskId: string, unitId: string, batchIndex: number,
  timings: BatchResult['timings'], traceId: string, status: string,
): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      INSERT INTO batch_performance_log
        (id, task_id, unit_id, batch_index,
         parse_duration_ms, rule_duration_ms, validate_duration_ms, insert_duration_ms, total_duration_ms,
         status, trace_id)
      VALUES
        (${uuidv4()}, ${taskId}, ${unitId}, ${batchIndex},
         ${timings.parseDurationMs}, ${timings.ruleDurationMs}, ${timings.validateDurationMs}, ${timings.insertDurationMs}, ${timings.totalDurationMs},
         ${status}, ${traceId})
      ON CONFLICT DO NOTHING
    `;
  } catch { /* ignore */ }
}

async function writeErrors(
  taskId: string, unitId: string, batchIndex: number,
  errors: BatchResult['errors'],
): Promise<void> {
  if (errors.length === 0) return;

  try {
    const sql = await getSql();
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const e of errors) {
      values.push(
        `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
      );
      params.push(
        uuidv4(),
        e.taskId,
        e.unitId,
        e.batchIndex,
        e.rowNumber,
        e.fieldName,
        e.rawValue,
        e.errorCode,
        e.errorReason,
        taskId.slice(0, 8), // traceId short form
      );
    }

    await sql.raw(
      `INSERT INTO import_task_errors
        (id, task_id, unit_id, batch_index, row_number, field_name, raw_value, error_code, error_reason, trace_id)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
  } catch { /* ignore */ }
}

// ============ 工具函数 ============

function maskSensitive(value: string): string {
  if (!value || value.length < 7) return '***';
  // 手机号脱敏：138****1234
  return value.slice(0, 3) + '****' + value.slice(-4);
}

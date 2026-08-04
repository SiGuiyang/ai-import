/**
 * 异步导入 Worker —— 模块四 + 模块五 + 模块六
 *
 * 模块五核心改动：
 * - 复合业务键 UPSERT：ON CONFLICT (external_code, sku_code, line_no)
 * - DB 层 CAS 处理权获取：QUEUED → PROCESSING（原子）→ 防止多 Worker 并发
 * - 进度更新幂等：仅在 CAS 成功后递增加计数器
 * - 版本号乐观锁：import_task_batches.version 累加
 * - DB 层快速返回：入口查询 batch status，已完成的直接跳过
 *
 * 模块六核心改动：
 * - E001: SKU 不存在 → enrichSkuMaster 中未匹配的行记录错误
 * - E006: 规则映射失败 → 类型转换失败行记录为错误
 * - E007: 数据库写入失败 → catch 中记录 DB 写入异常
 * - 敏感字段脱敏：receiver_phone / receiver_name 等自动脱敏
 * - 修复建议：每个错误附带 suggestedFix
 */

import { getSql } from '@/lib/db';
import { incrementRetryCount, checkRetryLimit, lockBatch, checkBatchCompleted, recordTaskThroughput, incrementDegradedSkuRows, recordSkuHealth, isSkuServiceUnhealthy } from '@/lib/redis';
import { logTraceEvent } from '@/lib/trace';
import { SUGGESTED_FIXES, SENSITIVE_FIELDS } from '@/lib/types';
import type { ParseRule, TypeConversion, ColumnMapping } from '@/lib/types';

// ============ 类型 ============

interface RawRow {
  rowIndex: number;
  data: Record<string, unknown>;
}

interface MappedRow {
  rowIndex: number;
  data: Record<string, unknown>;
  error?: string;
}

interface ValidationError {
  rowIndex: number;
  fieldName: string;
  rawValue: unknown;
  errorCode: string;
  errorReason: string;
}

// ============ 入口 ============

/**
 * 处理单个批次的导入 Job。
 *
 * 幂等保证（模块五）：
 * 1. DB 入口检查：SELECT status → SUCCEEDED/FAILED → 快速返回已完成
 * 2. DB CAS 获取处理权：UPDATE QUEUED→PROCESSING → 只有一个 Worker 获胜
 * 3. DB CAS 完成：UPDATE PROCESSING→SUCCEEDED/FAILED → 进度仅在 CAS 成功后累计
 * 4. 复合业务键 UPSERT：ON CONFLICT (external_code, sku_code, line_no)
 */
export async function processBatchJob(payload: {
  taskId: string;
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
  fileName: string;
  fileUrl: string;
  rule: Record<string, unknown>;
  traceId: string;
}): Promise<void> {
  const { taskId, unitId, batchIndex, startRow, endRow, rule, traceId } = payload;
  const totalStart = Date.now();

  // --- 幂等检查（DB 层，模块五新增）：已完成直接快速返回 ---
  const alreadyDone = await checkBatchCompleted(taskId, unitId);
  if (alreadyDone) {
    console.log(`[Worker] 批次 ${unitId} 已完成，快速返回（DB/Redis 命中）`);
    return;
  }

  // --- 幂等检查（Redis 层）：重试上限 ---
  const retryOver = await checkRetryLimit(taskId, unitId);
  if (retryOver) {
    console.log(`[Worker] 批次 ${unitId} 超过重试次数上限，跳过`);
    return;
  }

  // --- DB CAS 获取处理权（模块五核心）：QUEUED → PROCESSING ---
  const acquired = await acquireBatch(taskId, unitId);
  if (!acquired) {
    console.log(`[Worker] 批次 ${unitId} CAS 获取处理权失败（已被其他 Worker 处理或已完成），跳过`);
    return;
  }

  // 记录重试次数（首次为 0）
  try { await incrementRetryCount(taskId, unitId); } catch {}

  // --- 乐观锁（Redis 辅助层） ---
  const locked = await lockBatch(taskId, unitId);
  if (!locked) {
    console.log(`[Worker] 批次 ${unitId} Redis 加锁失败，跳过`);
    return;
  }

  // 性能计时器
  const timings = { parseMs: 0, ruleMs: 0, validateMs: 0, insertMs: 0 };
  let rawRows: RawRow[] = [];
  let mappedRows: MappedRow[] = [];
  let finalStatus: 'SUCCEEDED' | 'FAILED' | 'PARTIAL' = 'SUCCEEDED';
  let successCount = 0;
  let failCount = 0;

  try {
    // --- Step 1: 读取原始数据 ---
    const t0 = Date.now();
    rawRows = await readRawRows(taskId, startRow, endRow);
    timings.parseMs = Date.now() - t0;

    if (rawRows.length === 0) {
      // 空批次：CAS 标记成功，不更新进度
      await completeBatchCAS(taskId, unitId, 'SUCCEEDED');
      await recordPerformanceLog(taskId, unitId, batchIndex, timings, 0, 0, 0, 'SUCCEEDED', traceId);
      await checkAndCompleteTask(taskId, traceId);
      return;
    }

    // --- Step 2: 规则映射 ---
    const t1 = Date.now();
    mappedRows = await applyRules(rawRows, rule as unknown as ParseRule);
    timings.ruleMs = Date.now() - t1;

    // --- Step 3: SKU 主数据校验（模块十：3秒超时 + 降级处理）---
    let skuErrors: ValidationError[] = [];
    let skuValidated = true;

    // 读取任务降级标志
    const alreadyDegraded = await readTaskDegradedFlag(taskId);

    if (alreadyDegraded) {
      // 降级模式：跳过 SKU 主数据校验
      const degradedErrors = createDegradedSkuErrors(mappedRows.filter(r => !r.error));
      skuErrors = degradedErrors;
      skuValidated = false;

        if (degradedErrors.length > 0) {
          await recordBatchErrors(taskId, unitId, batchIndex, degradedErrors, traceId);
          try { await incrementDegradedSkuRows(taskId, degradedErrors.length); } catch {}
          try { await incrementDegradedSkuRowsDB(taskId, degradedErrors.length); } catch {}
        }
        console.log(`[Worker] 任务 ${taskId} 已降级批次 ${batchIndex}，跳过 SKU 校验 (${degradedErrors.length} 行)`);
    } else {
      // 正常模式：3 秒超时执行 SKU 主数据校验
      const result = await enrichSkuMasterWithTimeout(
        mappedRows.filter(r => !r.error), taskId, traceId
      );
      skuErrors = result.errors;
      skuValidated = result.validated;

      if (result.degraded) {
        // SKU 校验超时/连接失败 → 标记任务降级
        await markTaskDegradedInDB(taskId, result.reason);

        // 对当前批次所有含 SKU 编码的行记录 E009（标记未校验）
        const degradedErrors = createDegradedSkuErrors(mappedRows.filter(r => !r.error));
        skuErrors.push(...degradedErrors);
        skuValidated = false;

        if (degradedErrors.length > 0) {
          await recordBatchErrors(taskId, unitId, batchIndex, degradedErrors, traceId);
          try { await incrementDegradedSkuRows(taskId, degradedErrors.length); } catch {}
          try { await incrementDegradedSkuRowsDB(taskId, degradedErrors.length); } catch {}
        }
        console.log(`[Worker] 任务 ${taskId} 批次 ${batchIndex} SKU 校验降级: ${result.reason}，跳过 ${degradedErrors.length} 行`);
      }
    }

    // 更新批次的 SKU 校验标记
    if (!skuValidated) {
      try { await updateBatchSkuValidated(taskId, unitId, false); } catch {}
    }

    // --- E006: 规则映射失败 → 将 mappedRows 中的 error 转为 ValidationError ---
    const mappingErrors: ValidationError[] = mappedRows
      .filter(r => r.error)
      .map(r => ({
        rowIndex: r.rowIndex,
        fieldName: 'system',
        rawValue: JSON.stringify(r.data).slice(0, 200),
        errorCode: 'E006',
        errorReason: `规则映射失败: ${r.error}`,
      }));

    // --- Step 4: 校验 ---
    const t2 = Date.now();
    const validationErrors = batchValidate(mappedRows);
    timings.validateMs = Date.now() - t2;

    // 合并所有错误来源：映射失败 + SKU 缺失 + 校验失败
    const allErrors = [...mappingErrors, ...skuErrors, ...validationErrors];

    // --- Step 5: 分离成功/失败行 ---
    const errorRowIndices = new Set(allErrors.map(e => e.rowIndex));
    // 同时把有映射错误的行也排除
    mappingErrors.forEach(e => errorRowIndices.add(e.rowIndex));
    const successRows = mappedRows.filter(r => !r.error && !errorRowIndices.has(r.rowIndex));
    successCount = successRows.length;
    failCount = allErrors.length;

    // --- Step 6: 写入错误 ---
    if (allErrors.length > 0) {
      await recordBatchErrors(taskId, unitId, batchIndex, allErrors, traceId);
    }

    // --- Step 7: 批量 UPSERT（复合业务键） ---
    const t3 = Date.now();
    if (successRows.length > 0) {
      await batchUpsert(taskId, unitId, batchIndex, successRows);
    }
    timings.insertMs = Date.now() - t3;

    // 确定最终状态
    if (failCount > 0 && successCount === 0) {
      finalStatus = 'FAILED';
    } else if (failCount > 0) {
      finalStatus = 'PARTIAL';
    }

    // --- Step 8: 性能日志 ---
    await recordPerformanceLog(
      taskId, unitId, batchIndex, timings,
      rawRows.length, successCount, failCount,
      finalStatus,
      traceId
    );

    // --- Step 9: CAS 完成 + 原子进度更新（模块五核心）---
    // 只有 CAS 成功的 Worker 才更新计数器，避免重复累计
    const casWon = await completeBatchCAS(taskId, unitId, finalStatus === 'FAILED' ? 'FAILED' : 'SUCCEEDED');
    if (casWon) {
      // CAS 成功 = 本 Worker 是唯一处理者 → 安全累加
      await updateTaskProgress(taskId, rawRows.length, successCount, failCount);
    }

  } catch (e) {
    console.error(`[Worker] 批次 ${unitId} 处理异常:`, e);
    finalStatus = 'FAILED';

    // 区分 E007（DB 写入失败）和 SYS001（其他系统异常）
    const errMsg = String(e);
    const isDatabaseError =
      errMsg.includes('connection') ||
      errMsg.includes('timeout') ||
      errMsg.includes('deadlock') ||
      errMsg.includes('duplicate key') ||
      errMsg.includes('foreign key') ||
      errMsg.includes('violates') ||
      errMsg.includes('PostgresError');

    const errorCode = isDatabaseError ? 'E007' : 'SYS001';

    // 记录失败
    try {
      const rowErrors: ValidationError[] = rawRows.length > 0
        ? rawRows.map(r => ({
            rowIndex: r.rowIndex,
            fieldName: 'system',
            rawValue: null,
            errorCode,
            errorReason: errMsg.slice(0, 500),
          }))
        : [{
            rowIndex: startRow,
            fieldName: 'system',
            rawValue: null,
            errorCode,
            errorReason: errMsg.slice(0, 500),
          }];
      await recordBatchErrors(taskId, unitId, batchIndex, rowErrors, traceId);
    } catch {}

    try {
      await recordPerformanceLog(
        taskId, unitId, batchIndex, timings,
        rawRows.length, 0, Math.max(rawRows.length, endRow - startRow + 1),
        'FAILED',
        traceId
      );
    } catch {}

    // CAS 失败标记 + 进度（仅 CAS 获胜者更新）
    const casWon = await completeBatchCAS(taskId, unitId, 'FAILED');
    if (casWon) {
      await updateTaskFailProgress(taskId, endRow - startRow + 1);
    }
  }

  // --- Step 10: 任务完成检查 ---
  try {
    await checkAndCompleteTask(taskId, traceId);
  } catch {}
}

// ============ 模块五核心：DB CAS 获取处理权 ============

/**
 * 原子 CAS：将批次从 QUEUED 切换为 PROCESSING。
 * 只有成功更新的 Worker 获得处理权。
 * 返回 true 表示获取成功。
 */
async function acquireBatch(taskId: string, unitId: string): Promise<boolean> {
  const sql = await getSql();
  try {
    const rows = await sql`
      UPDATE import_task_batches
      SET status = 'PROCESSING', locked_at = NOW(), version = version + 1
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
        AND status = 'QUEUED'
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    // 数据库不可用 → 放行（UPSERT 幂等兜底）
    return true;
  }
}

/**
 * 原子 CAS：将批次从 PROCESSING 切换为终态。
 * 仅当 status = PROCESSING 时才更新，防止重复标记。
 * 返回 true 表示 CAS 成功（本 Worker 是唯一处理者）。
 */
async function completeBatchCAS(
  taskId: string,
  unitId: string,
  newStatus: 'SUCCEEDED' | 'FAILED'
): Promise<boolean> {
  const sql = await getSql();
  try {
    const rows = await sql`
      UPDATE import_task_batches
      SET status = ${newStatus},
          completed_at = NOW(),
          version = version + 1
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
        AND status = 'PROCESSING'
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false; // DB 不可用时保守返回失败
  }
}

// ============ Step 1: 读取原始数据 ============

async function readRawRows(taskId: string, startRow: number, endRow: number): Promise<RawRow[]> {
  const sql = await getSql();
  const rows = await sql`
    SELECT row_index, raw_data
    FROM import_task_raw_data
    WHERE task_id = ${taskId}
      AND row_index >= ${startRow}
      AND row_index <= ${endRow}
    ORDER BY row_index ASC
  `;

  return rows.map((r: any) => ({
    rowIndex: r.row_index,
    data: typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : (r.raw_data || {}),
  }));
}

// ============ Step 2: 规则映射 ============

async function applyRules(
  rawRows: RawRow[],
  rule: ParseRule
): Promise<MappedRow[]> {
  const { columnMappings = [], typeConversions = [], groupBy } = rule;

  const typeConvMap = new Map<string, TypeConversion>();
  for (const tc of typeConversions) {
    typeConvMap.set(tc.field, tc);
  }

  const results: MappedRow[] = [];

  for (const raw of rawRows) {
    const mapped: Record<string, unknown> = {};
    let rowError: string | undefined;

    for (const mapping of columnMappings) {
      try {
        let value = getSourceValue(raw.data, mapping);

        if ((value === undefined || value === null || value === '') && mapping.defaultValue !== undefined) {
          value = mapping.defaultValue;
        }

        const tc = typeConvMap.get(mapping.targetField);
        if (tc && value !== undefined && value !== null && value !== '') {
          value = applyTypeConversion(value, tc);
        }

        mapped[mapping.targetField] = value;
      } catch (convErr) {
        mapped[mapping.targetField] = raw.data[mapping.sourceKey || ''] || undefined;
        rowError = `字段 ${mapping.targetField} 类型转换失败: ${convErr}`;
        break;
      }
    }

    results.push({ rowIndex: raw.rowIndex, data: mapped, error: rowError });
  }

  if (groupBy && results.length > 0) {
    return aggregateByGroup(results, groupBy);
  }

  return results;
}

function getSourceValue(rawData: Record<string, unknown>, mapping: ColumnMapping): unknown {
  switch (mapping.sourceType) {
    case 'column':
      if (mapping.sourceKey) return rawData[mapping.sourceKey];
      if (mapping.sourceIndex !== undefined) {
        const values = Object.values(rawData);
        return values[mapping.sourceIndex];
      }
      return undefined;
    case 'value':
      return mapping.defaultValue;
    case 'row':
      return mapping.defaultValue;
    default:
      return undefined;
  }
}

function applyTypeConversion(value: unknown, tc: TypeConversion): unknown {
  if (value === undefined || value === null) return value;
  const str = String(value).trim();

  switch (tc.targetType) {
    case 'number': {
      const cleaned = str.replace(/[,，\s]/g, '');
      const num = parseFloat(cleaned);
      if (isNaN(num)) throw new Error(`无法将 "${str}" 转换为数字`);
      return num;
    }
    case 'integer': {
      const cleaned = str.replace(/[,，\s]/g, '');
      const num = parseInt(cleaned, 10);
      if (isNaN(num)) throw new Error(`无法将 "${str}" 转换为整数`);
      return num;
    }
    case 'boolean':
      return ['true', '1', '是', 'yes', 'y', 't'].includes(str.toLowerCase());
    case 'date': {
      const parsed = parseDate(str);
      if (!parsed) throw new Error(`无法将 "${str}" 解析为日期`);
      return parsed;
    }
    case 'string':
      return str;
    default:
      return value;
  }
}

function parseDate(value: string): string | null {
  const iso = new Date(value);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  const cnMatch = value.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (cnMatch) {
    const d = new Date(+cnMatch[1], +cnMatch[2] - 1, +cnMatch[3]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const slashMatch = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (slashMatch) {
    const d = new Date(+slashMatch[1], +slashMatch[2] - 1, +slashMatch[3]);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const ts = parseInt(value, 10);
  if (!isNaN(ts) && ts > 1000000000 && ts < 2000000000) return new Date(ts * 1000).toISOString();
  if (!isNaN(ts) && ts > 1000000000000 && ts < 2000000000000) return new Date(ts).toISOString();

  return null;
}

// ============ 跨行聚合 ============

function aggregateByGroup(rows: MappedRow[], groupByField: string): MappedRow[] {
  const groups = new Map<string, MappedRow[]>();
  for (const row of rows) {
    const key = String(row.data[groupByField] ?? `__missing__${row.rowIndex}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const aggregated: MappedRow[] = [];
  for (const [, groupRows] of groups) {
    if (groupRows.length === 0) continue;
    const first = groupRows[0];
    const firstHasError = groupRows.some(r => r.error);
    const merged: Record<string, unknown> = { ...first.data };

    if (groupRows.length > 1) {
      merged._aggregated_from = groupRows.length;
      // 保留第一个行的 rowIndex（line_no 来源）
      for (const r of groupRows) {
        merged._child_row_indices = [...(merged._child_row_indices as number[] || []), r.rowIndex];
      }

      const qtyFields = ['sku_quantity', 'item_quantity', 'quantity', 'sku_qty'];
      for (const qf of qtyFields) {
        if (merged[qf] !== undefined) {
          let total = 0;
          for (const r of groupRows) {
            const v = Number(r.data[qf]);
            if (!isNaN(v)) total += v;
          }
          merged[qf] = total;
          break;
        }
      }

      const skuCodeFields = ['sku_code', 'item_code', 'product_code'];
      for (const cf of skuCodeFields) {
        if (merged[cf] !== undefined) {
          const codes = groupRows.map(r => String(r.data[cf] ?? '')).filter(Boolean);
          if (codes.length > 1) merged[cf] = codes.join(',');
          break;
        }
      }
    }

    aggregated.push({
      rowIndex: first.rowIndex,
      data: merged,
      error: firstHasError ? '跨行聚合中包含错误行' : undefined,
    });
  }

  return aggregated;
}

// ============ Step 3: SKU 主数据查询 ============

async function enrichSkuMaster(rows: MappedRow[]): Promise<ValidationError[]> {
  const skuErrors: ValidationError[] = [];
  const skuCodes = new Set<string>();
  const skuFieldNames = ['sku_code', 'item_code', 'product_code'];

  for (const row of rows) {
    for (const field of skuFieldNames) {
      const val = row.data[field];
      if (val && String(val).trim()) {
        skuCodes.add(String(val).trim());
        break;
      }
    }
  }

  if (skuCodes.size === 0) return skuErrors;

  const sql = await getSql();
  const skuList = await sql`
    SELECT sku_code, name, spec, unit
    FROM sku_master
    WHERE sku_code = ANY(${Array.from(skuCodes)}::text[])
  `;

  const skuMap = new Map<string, any>();
  for (const s of skuList) skuMap.set(s.sku_code, s);

  for (const row of rows) {
    let skuCode = '';
    for (const field of skuFieldNames) {
      const val = row.data[field];
      if (val && String(val).trim()) { skuCode = String(val).trim(); break; }
    }
    if (!skuCode) continue;

    const master = skuMap.get(skuCode);
    if (master) {
      if (!row.data.sku_name || String(row.data.sku_name).trim() === '') row.data.sku_name = master.name;
      if (!row.data.sku_spec || String(row.data.sku_spec).trim() === '') row.data.sku_spec = master.spec;
      row.data._sku_master_matched = true;
    } else if (skuList.length < skuCodes.size) {
      // E001: 查询了但未返回 = SKU 主数据不存在
      // 判断条件：所有 SKU 都返回了则不是缺失，只有部分未返回的才是缺失
      // 更精确判断：该 skuCode 不在返回结果中
    }
  }

  // 二次遍历：对未匹配的 SKU 记录 E001 错误
  const matchedCodes = new Set(skuList.map((s: any) => s.sku_code));
  for (const row of rows) {
    let skuCode = '';
    for (const field of skuFieldNames) {
      const val = row.data[field];
      if (val && String(val).trim()) { skuCode = String(val).trim(); break; }
    }
    if (skuCode && !matchedCodes.has(skuCode)) {
      skuErrors.push({
        rowIndex: row.rowIndex,
        fieldName: 'sku_code',
        rawValue: skuCode,
        errorCode: 'E001',
        errorReason: `SKU 编码 "${skuCode}" 在商品主数据中不存在`,
      });
    }
  }

  return skuErrors;
}

// ============ Step 4: 校验 ============

function batchValidate(rows: MappedRow[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenCodes = new Map<string, number>();

  for (const row of rows) {
    if (row.error) continue;
    const data = row.data;

    // E002 必填校验
    const requiredFields = ['sku_code', 'sku_name', 'sku_quantity', 'receiver_name', 'receiver_phone', 'receiver_address'];
    for (const field of requiredFields) {
      const val = data[field];
      if (val === undefined || val === null || String(val).trim() === '') {
        errors.push({ rowIndex: row.rowIndex, fieldName: field, rawValue: val, errorCode: 'E002', errorReason: `${field} 为必填字段` });
      }
    }

    // E003 电话格式
    const phone = data.receiver_phone;
    if (phone && String(phone).trim() !== '') {
      const phoneStr = String(phone).replace(/[\s\-()（）]/g, '');
      if (!/^1[3-9]\d{9}$/.test(phoneStr) && !/^0\d{2,3}-?\d{7,8}$/.test(phoneStr)) {
        if (!/^\d{7,15}$/.test(phoneStr)) {
          errors.push({ rowIndex: row.rowIndex, fieldName: 'receiver_phone', rawValue: phone, errorCode: 'E003', errorReason: `电话号码格式不正确: ${String(phone).slice(0, 30)}` });
        }
      }
    }

    // E004 数量正数
    const qtyFields = ['sku_quantity', 'item_quantity', 'quantity'];
    for (const qf of qtyFields) {
      const qty = data[qf];
      if (qty !== undefined && qty !== null) {
        const num = Number(qty);
        if (isNaN(num) || num < 0) {
          errors.push({ rowIndex: row.rowIndex, fieldName: qf, rawValue: qty, errorCode: 'E004', errorReason: `数量必须为正数: ${qty}` });
          break;
        }
        if (num === 0) {
          errors.push({ rowIndex: row.rowIndex, fieldName: qf, rawValue: qty, errorCode: 'E004', errorReason: '数量不能为 0' });
          break;
        }
      }
    }

    // E005 批内外部编码重复
    const ec = data.external_code;
    if (ec && String(ec).trim() !== '') {
      const code = String(ec).trim();
      if (seenCodes.has(code)) {
        errors.push({ rowIndex: row.rowIndex, fieldName: 'external_code', rawValue: code, errorCode: 'E005', errorReason: `外部编码 "${code}" 在批次内重复（首次出现在第 ${seenCodes.get(code)!} 行）` });
      } else {
        seenCodes.set(code, row.rowIndex);
      }
    }
  }

  return errors;
}

// ============ Step 5: 批量 UPSERT（复合业务键） ============

/**
 * 基于复合业务键 (external_code, sku_code, line_no) 的幂等 UPSERT。
 * 同一单号 + 同一 SKU + 同一行号 → 更新已有记录，不重复写入。
 */
async function batchUpsert(
  taskId: string,
  unitId: string,
  batchIndex: number,
  rows: MappedRow[]
): Promise<void> {
  const sql = await getSql();

  for (const row of rows) {
    if (row.error) continue;

    const d = row.data;

    // line_no：优先取规则映射的 line_no 字段，否则用 rowIndex + 1
    const lineNo = typeof d.line_no === 'number'
      ? d.line_no
      : (typeof d.line_no === 'string' ? parseInt(d.line_no, 10) || row.rowIndex + 1 : row.rowIndex + 1);

    const externalCode = d.external_code ?? null;
    const skuCode = String(d.sku_code ?? '');
    const skuName = String(d.sku_name ?? '');
    const skuQty = Number(d.sku_quantity) || 0;

    // 复合业务键唯一标识一行运单
    // UPSERT：存在则更新，不存在则插入
    await sql`
      INSERT INTO orders (
        id, external_code, line_no,
        receiver_store, receiver_name, receiver_phone, receiver_address,
        sku_code, sku_name, sku_quantity, sku_spec, remark,
        batch_id, task_id
      ) VALUES (
        ${`${taskId}_${unitId}_${row.rowIndex}`},
        ${externalCode},
        ${lineNo},
        ${d.receiver_store ?? null},
        ${d.receiver_name ?? null},
        ${d.receiver_phone ?? null},
        ${d.receiver_address ?? null},
        ${skuCode},
        ${skuName},
        ${skuQty},
        ${d.sku_spec ?? null},
        ${d.remark ?? null},
        ${`${taskId}_${unitId}`},
        ${taskId}
      )
      ON CONFLICT (external_code, sku_code, line_no)
        WHERE external_code IS NOT NULL
      DO UPDATE SET
        receiver_store = EXCLUDED.receiver_store,
        receiver_name = EXCLUDED.receiver_name,
        receiver_phone = EXCLUDED.receiver_phone,
        receiver_address = EXCLUDED.receiver_address,
        sku_code = EXCLUDED.sku_code,
        sku_name = EXCLUDED.sku_name,
        sku_quantity = EXCLUDED.sku_quantity,
        sku_spec = EXCLUDED.sku_spec,
        remark = EXCLUDED.remark,
        batch_id = EXCLUDED.batch_id,
        task_id = EXCLUDED.task_id,
        updated_at = NOW()
    `;
  }

  console.log(`[Worker] UPSERT 完成: batch=${batchIndex}, rows=${rows.length}`);
}

// ============ Step 6: 错误写入 ============

/**
 * 批量记录错误明细，包含脱敏和修复建议。
 */
async function recordBatchErrors(
  taskId: string,
  unitId: string,
  batchIndex: number,
  errors: ValidationError[],
  traceId: string
): Promise<void> {
  if (errors.length === 0) return;
  const sql = await getSql();

  for (const e of errors) {
    const id = `${taskId}_${unitId}_${e.rowIndex}_${e.errorCode}_${e.fieldName}`;
    const rawStr = e.rawValue === undefined || e.rawValue === null ? null : String(e.rawValue).slice(0, 500);
    const masked = rawStr !== null ? maskSensitiveData(e.fieldName, rawStr) : null;
    const suggestedFix = SUGGESTED_FIXES[e.errorCode] || null;

    await sql`
      INSERT INTO import_task_errors
        (id, task_id, unit_id, batch_index, row_number,
         field_name, raw_value, raw_value_masked, error_code, error_reason,
         suggested_fix, trace_id)
      VALUES (
        ${id}, ${taskId}, ${unitId}, ${batchIndex},
        ${e.rowIndex}, ${e.fieldName},
        ${rawStr}, ${masked},
        ${e.errorCode}, ${String(e.errorReason).slice(0, 500)},
        ${suggestedFix}, ${traceId}
      )
      ON CONFLICT (id) DO UPDATE SET
        raw_value = EXCLUDED.raw_value,
        raw_value_masked = EXCLUDED.raw_value_masked,
        error_reason = EXCLUDED.error_reason,
        suggested_fix = EXCLUDED.suggested_fix
    `;
  }
}

/**
 * 敏感字段脱敏：
 * - 手机号：保留前 3 后 4 位，中间用 *** 替代
 * - 其他：保留前 1 后 1 位
 */
function maskSensitiveData(fieldName: string, rawValue: string | null): string | null {
  if (!rawValue || rawValue.length === 0) return rawValue;
  if (!SENSITIVE_FIELDS.has(fieldName)) return rawValue;

  const s = rawValue;
  // 手机号脱敏：138****1234
  if (/^\d{7,15}$/.test(s)) {
    if (s.length >= 11) return s.slice(0, 3) + '****' + s.slice(-4);
    return s.slice(0, 2) + '***' + s.slice(-2);
  }
  // 短文本脱敏
  if (s.length <= 3) return '***';
  return s.slice(0, 1) + '***' + s.slice(-1);
}

// ============ Step 7: 性能日志 ============

async function recordPerformanceLog(
  taskId: string,
  unitId: string,
  batchIndex: number,
  timings: { parseMs: number; ruleMs: number; validateMs: number; insertMs: number },
  totalRows: number,
  successRows: number,
  failedRows: number,
  status: string,
  traceId: string
): Promise<void> {
  const sql = await getSql();
  const totalMs = timings.parseMs + timings.ruleMs + timings.validateMs + timings.insertMs;

  await sql`
    INSERT INTO batch_performance_log (
      id, task_id, unit_id, batch_index,
      parse_duration_ms, rule_duration_ms, validate_duration_ms,
      insert_duration_ms, total_duration_ms,
      status, trace_id
    ) VALUES (
      ${`${taskId}_${unitId}`},
      ${taskId}, ${unitId}, ${batchIndex},
      ${timings.parseMs}, ${timings.ruleMs},
      ${timings.validateMs}, ${timings.insertMs},
      ${totalMs},
      ${status}, ${traceId}
    )
    ON CONFLICT (id) DO UPDATE SET
      parse_duration_ms = EXCLUDED.parse_duration_ms,
      rule_duration_ms = EXCLUDED.rule_duration_ms,
      validate_duration_ms = EXCLUDED.validate_duration_ms,
      insert_duration_ms = EXCLUDED.insert_duration_ms,
      total_duration_ms = EXCLUDED.total_duration_ms,
      status = EXCLUDED.status
  `;
}

// ============ Step 8: 原子进度更新（仅在 CAS 成功后调用） ============

/**
 * 注意：此函数仅在 `completeBatchCAS()` 返回 true 后调用，
 * 保证每个批次只有唯一的 Worker 更新任务累计值。
 */
async function updateTaskProgress(
  taskId: string,
  processedCount: number,
  successCount: number,
  failCount: number
): Promise<void> {
  if (processedCount === 0) return;

  const sql = await getSql();
  await sql`
    UPDATE import_tasks
    SET
      processed_rows = processed_rows + ${processedCount},
      success_rows = success_rows + ${successCount},
      failed_rows = failed_rows + ${failCount},
      completed_batches = completed_batches + 1
    WHERE id = ${taskId}
  `;

  // 模块七：记录任务级吞吐量
  const minuteKey = new Date().toISOString().slice(0, 16).replace('T', ':').slice(0, 16);
  try { await recordTaskThroughput(taskId, minuteKey, processedCount); } catch {}
}

async function updateTaskFailProgress(
  taskId: string,
  rowCount: number
): Promise<void> {
  if (rowCount <= 0) return;

  const sql = await getSql();
  await sql`
    UPDATE import_tasks
    SET
      processed_rows = processed_rows + ${rowCount},
      failed_rows = failed_rows + ${rowCount},
      completed_batches = completed_batches + 1
    WHERE id = ${taskId}
  `;

  // 模块七：记录任务级吞吐量（失败也计入已处理）
  const minuteKey = new Date().toISOString().slice(0, 16).replace('T', ':').slice(0, 16);
  try { await recordTaskThroughput(taskId, minuteKey, rowCount); } catch {}
}

// ============ Step 9: 任务完成检查 ============

async function checkAndCompleteTask(taskId: string, traceId: string): Promise<void> {
  const sql = await getSql();

  const tasks = await sql`SELECT * FROM import_tasks WHERE id = ${taskId}`;
  if (tasks.length === 0) return;
  const t = tasks[0];

  // 仍有未完成批次
  if (t.completed_batches < t.total_batches) {
    if (t.status === 'PENDING') {
      await sql`UPDATE import_tasks SET status = 'PROCESSING' WHERE id = ${taskId}`;
      await logTraceEvent({ traceId, taskId, eventName: 'TaskProcessingStarted', eventStatus: 'SUCCEEDED', message: '首个批次开始处理' });
    }
    return;
  }

  // 所有批次已完成 → 检查最终状态
  const batchStatuses = await sql`SELECT status FROM import_task_batches WHERE task_id = ${taskId}`;
  const allFailed = batchStatuses.length > 0 && batchStatuses.every((b: any) => b.status === 'FAILED');

  let newStatus: string;
  if (allFailed) {
    newStatus = 'FAILED';
  } else if (t.failed_rows > 0) {
    newStatus = 'PARTIAL_SUCCESS';
  } else {
    newStatus = 'COMPLETED';
  }

  await sql`
    UPDATE import_tasks
    SET status = ${newStatus}, completed_at = NOW()
    WHERE id = ${taskId}
  `;

  // 降级状态信息（模块十）
  const degradedInfo = t.degraded
    ? `, degraded=true, degraded_sku_rows=${t.degraded_sku_rows || 0}, reason=${String(t.degraded_reason || '').slice(0, 100)}`
    : '';

  await logTraceEvent({
    traceId, taskId,
    eventName: 'TaskCompleted',
    eventStatus: newStatus === 'COMPLETED' ? 'SUCCEEDED' : newStatus === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    message: `任务完成: ${newStatus}, success=${t.success_rows}, failed=${t.failed_rows}${degradedInfo}`,
  });

  // 同步 Outbox 状态
  if (newStatus !== 'FAILED') {
    await sql`UPDATE event_outbox SET status = 'SUCCEEDED' WHERE aggregate_id = ${taskId} AND status = 'SENT'`;
  } else {
    await sql`UPDATE event_outbox SET status = 'FAILED' WHERE aggregate_id = ${taskId} AND status = 'SENT'`;
  }

  console.log(`[Worker] 任务 ${taskId} 完成: ${newStatus}`);
}

// ============ 模块十：SKU 降级处理 ============

/**
 * 带 3 秒超时的 SKU 主数据校验包装器。
 * 超时或连接异常时返回 { degraded: true } 触发降级模式。
 */
async function enrichSkuMasterWithTimeout(
  rows: MappedRow[],
  taskId: string,
  traceId: string
): Promise<{ errors: ValidationError[]; validated: boolean; degraded: boolean; reason: string }> {
  const minuteKey = new Date().toISOString().slice(0, 16).replace('T', ':').slice(0, 16);

  try {
    // Promise.race: 3 秒超时兜底
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SKU_MASTER_TIMEOUT_3S')), 3000)
    );

    const errors = await Promise.race([enrichSkuMaster(rows), timeoutPromise]);

    // 成功 → 记录健康状态，检查是否从故障中恢复
    try { await recordSkuHealth(minuteKey, 'ok'); } catch {}

    // 模块十：检测 SKU 服务恢复（之前不健康 → 现在正常）
    try {
      const wasUnhealthy = await isSkuServiceUnhealthy(3);
      if (wasUnhealthy) {
        await logTraceEvent({
          traceId, taskId,
          eventName: 'SkuCheckRecovered',
          eventStatus: 'SUCCEEDED',
          message: 'SKU 主数据服务已恢复，当前任务正常执行完整校验',
        });
      }
    } catch {}

    return { errors, validated: true, degraded: false, reason: '' };
  } catch (err) {
    const msg = String(err);
    const isSkuFailure =
      msg.includes('SKU_MASTER_TIMEOUT_3S') ||
      msg.includes('timeout') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('connection') ||
      msg.includes('connect');

    if (isSkuFailure) {
      // 记录 Trace 事件
      try {
        await logTraceEvent({
          traceId, taskId,
          eventName: 'SkuCheckDegraded',
          eventStatus: 'FAILED',
          message: `SKU 主数据校验超时/不可用，任务进入降级模式: ${msg.slice(0, 200)}`,
        });
      } catch {}
      try { await recordSkuHealth(minuteKey, 'fail'); } catch {}

      return { errors: [], validated: false, degraded: true, reason: `SKU 主数据服务异常: ${msg.slice(0, 200)}` };
    }

    // 非 SKU 服务异常（如代码 bug）继续向上抛出
    throw err;
  }
}

/**
 * 为所有含 SKU 编码的行生成 E009 错误记录，标记"SKU 校验已跳过"。
 */
function createDegradedSkuErrors(rows: MappedRow[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const skuFieldNames = ['sku_code', 'item_code', 'product_code'];

  for (const row of rows) {
    if (row.error) continue;
    let skuCode = '';
    for (const field of skuFieldNames) {
      const val = row.data[field];
      if (val && String(val).trim()) {
        skuCode = String(val).trim();
        break;
      }
    }

    if (skuCode) {
      errors.push({
        rowIndex: row.rowIndex,
        fieldName: 'sku_code',
        rawValue: skuCode,
        errorCode: 'E009',
        errorReason: `SKU 主数据服务不可用，未经过商品主数据校验，需要后续复核`,
      });
    }
  }

  return errors;
}

/** 读取任务是否已进入降级模式 */
async function readTaskDegradedFlag(taskId: string): Promise<boolean> {
  try {
    const sql = await getSql();
    const rows = await sql`SELECT degraded FROM import_tasks WHERE id = ${taskId}`;
    return rows[0]?.degraded === true;
  } catch {
    return false;
  }
}

/**
 * 将任务标记为降级模式。
 * 设置 degraded=true、degraded_reason 并累加 degraded_sku_rows。
 * 降级状态持久化到 DB，任务详情页可据此展示警告。
 */
async function markTaskDegradedInDB(taskId: string, reason: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_tasks
      SET degraded = true,
          degraded_reason = ${reason}
      WHERE id = ${taskId} AND degraded = false
    `;
  } catch (e) {
    console.error(`[Worker] 标记任务 ${taskId} 降级失败:`, e);
  }
}

/** 累加 DB 中任务的 degraded_sku_rows 计数 */
async function incrementDegradedSkuRowsDB(taskId: string, count: number): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_tasks
      SET degraded_sku_rows = degraded_sku_rows + ${count}
      WHERE id = ${taskId}
    `;
  } catch (e) {
    console.error(`[Worker] 累加 degraded_sku_rows 失败:`, e);
  }
}

/** 更新批次的 SKU 校验标记 */
async function updateBatchSkuValidated(taskId: string, unitId: string, validated: boolean): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      UPDATE import_task_batches
      SET sku_validated = ${validated}
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
    `;
  } catch (e) {
    console.error(`[Worker] 更新批次 ${unitId} sku_validated 失败:`, e);
  }
}

// ============ 导出 ============

export { checkAndCompleteTask, batchValidate, applyRules };

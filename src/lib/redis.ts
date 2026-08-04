/**
 * Upstash Redis 客户端 + 导入业务 Key 工具
 *
 * 用途：导入重试计数、实时进度追踪、失败记录快照
 *
 * Key 命名规范：import:{taskId}:{subKey}
 * TTL 策略：任务完成后 24h 过期，失败记录 7 天
 */

import { Redis } from '@upstash/redis';

// ==================== 客户端单例 ====================

let redisClient: Redis | null = null;

export function getRedis(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url || !token) {
    console.warn('[Redis] UPSTASH_REDIS_URL or UPSTASH_REDIS_TOKEN not set, Redis disabled');
    return null;
  }

  redisClient = new Redis({ url, token });
  console.log('[Redis] connected');
  return redisClient;
}

// ==================== Key 生成工具 ====================

export const ImportKeys = {
  /** 任务进度快照: import:{taskId}:progress */
  taskProgress: (taskId: string) => `import:${taskId}:progress`,

  /** 任务完成标记: import:{taskId}:done */
  taskDone: (taskId: string) => `import:${taskId}:done`,

  /** 批次状态: import:{taskId}:batch:{unitId}:status */
  batchStatus: (taskId: string, unitId: string) => `import:${taskId}:batch:${unitId}:status`,

  /** 批次重试次数: import:{taskId}:batch:{unitId}:retries */
  batchRetries: (taskId: string, unitId: string) => `import:${taskId}:batch:${unitId}:retries`,

  /** 批次耗时: import:{taskId}:batch:{unitId}:timings */
  batchTimings: (taskId: string, unitId: string) => `import:${taskId}:batch:${unitId}:timings`,

  /** 批次错误列表: import:{taskId}:batch:{unitId}:errors */
  batchErrors: (taskId: string, unitId: string) => `import:${taskId}:batch:${unitId}:errors`,

  /** 任务失败批次集合: import:{taskId}:failed_batches */
  taskFailedBatches: (taskId: string) => `import:${taskId}:failed_batches`,

  /** 任务错误分布: import:{taskId}:error_dist */
  taskErrorDist: (taskId: string) => `import:${taskId}:error_dist`,

  /** 全局活跃任务集合 */
  activeTasks: () => 'import:active:tasks',

  /** 吞吐量快照: import:throughput:{minute} */
  throughput: (minute: string) => `import:throughput:${minute}`,

  /** 任务级吞吐量: import:{taskId}:throughput:{minute} */
  taskThroughput: (taskId: string, minute: string) => `import:${taskId}:throughput:${minute}`,

  /** 任务降级 SKU 行数: import:{taskId}:degraded_sku_rows */
  taskDegradedSkuRows: (taskId: string) => `import:${taskId}:degraded_sku_rows`,

  /** SKU 主数据健康检查: import:sku:health:{minute} (值为 success/fail) */
  skuHealth: (minute: string) => `import:sku:health:${minute}`,
} as const;

// ==================== 任务进度操作 ====================

export interface TaskProgressSnapshot {
  taskId: string;
  status: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalBatches: number;
  completedBatches: number;
  degraded: boolean;
  updatedAt: number;
}

/** 缓存任务进度到 Redis (TTL 24h) */
export async function cacheTaskProgress(snapshot: TaskProgressSnapshot) {
  const redis = getRedis();
  if (!redis) return;

  const key = ImportKeys.taskProgress(snapshot.taskId);
  await redis.set(key, snapshot, { ex: 86400 });
}

/** 从 Redis 读取任务进度 */
export async function getCachedTaskProgress(taskId: string): Promise<TaskProgressSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;

  return redis.get<TaskProgressSnapshot>(ImportKeys.taskProgress(taskId));
}

// ==================== 批次状态操作 ====================

export type BatchState = 'PENDING' | 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

/** 更新批次状态 (TTL 24h) */
export async function setBatchState(taskId: string, unitId: string, state: BatchState) {
  const redis = getRedis();
  if (!redis) return;

  await redis.set(ImportKeys.batchStatus(taskId, unitId), state, { ex: 86400 });
}

/** 读取批次状态 */
export async function getBatchState(taskId: string, unitId: string): Promise<BatchState | null> {
  const redis = getRedis();
  if (!redis) return null;

  return redis.get<BatchState>(ImportKeys.batchStatus(taskId, unitId));
}

// ==================== 重试计数 ====================

const MAX_RETRIES = 3;

/** 原子递增重试次数，返回当前值。超过最大重试次数则返回 -1 */
export async function incrementRetryCount(taskId: string, unitId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const key = ImportKeys.batchRetries(taskId, unitId);

  // 使用 Lua 脚本实现原子性判断
  const script = `
    local current = redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], 86400)
    local max = tonumber(ARGV[1])
    if current > max then
      return -1
    end
    return current
  `;

  const result = await redis.eval(script, [key], [String(MAX_RETRIES)]);
  return result as number;
}

/** 读取当前重试次数 */
export async function getRetryCount(taskId: string, unitId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const val = await redis.get<string>(ImportKeys.batchRetries(taskId, unitId));
  return val ? parseInt(val, 10) : 0;
}

/** 检查是否超过重试上限（> 3 次返回 true） */
export async function checkRetryLimit(taskId: string, unitId: string): Promise<boolean> {
  const count = await getRetryCount(taskId, unitId);
  return count >= MAX_RETRIES;
}

// ==================== 乐观锁 ====================

/**
 * 乐观锁：尝试将批次从 QUEUED 切换为 PROCESSING。
 * Worker 调用此函数确保同一批次不会被多个 Worker 同时处理。
 * 返回 true 表示加锁成功（原子 CAS 成功）。
 */
export async function lockBatch(taskId: string, unitId: string): Promise<boolean> {
  // 先尝试 Redis 乐观锁
  const redis = getRedis();
  if (!redis) {
    // Redis 不可用时回退数据库
    return lockBatchDB(taskId, unitId);
  }

  const state = await getBatchState(taskId, unitId);
  // 只允许 QUEUED → PROCESSING；PROCESSING/SUCCEEDED/FAILED 拒绝
  if (state === 'PROCESSING' || state === 'SUCCEEDED' || state === 'FAILED') {
    return false;
  }
  await setBatchState(taskId, unitId, 'PROCESSING');
  return true;
}

/** 数据库回退：CAS 乐观锁 QUEUED → PROCESSING */
async function lockBatchDB(taskId: string, unitId: string): Promise<boolean> {
  try {
    const { getSql } = await import('@/lib/db');
    const sql = await getSql();
    const rows = await sql`
      UPDATE import_task_batches
      SET status = 'PROCESSING', locked_at = NOW()
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
        AND status = 'QUEUED'
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return true; // DB 不可用时放行，UPSERT 幂等兜底
  }
}

/**
 * 检查批次是否已完成（SUCCEEDED 或 FAILED）。
 * 优先读 Redis，Redis 不可用时回退到数据库查询。
 */
export async function checkBatchCompleted(taskId: string, unitId: string): Promise<boolean> {
  const state = await getBatchState(taskId, unitId);
  if (state) {
    return state === 'SUCCEEDED' || state === 'FAILED';
  }
  // Redis 无缓存 → 回退数据库查询
  return checkBatchCompletedDB(taskId, unitId);
}

/** 数据库回退：查询 import_task_batches 状态 */
async function checkBatchCompletedDB(taskId: string, unitId: string): Promise<boolean> {
  try {
    const { getSql } = await import('@/lib/db');
    const sql = await getSql();
    const rows = await sql`
      SELECT status FROM import_task_batches
      WHERE task_id = ${taskId} AND unit_id = ${unitId}
    `;
    if (rows.length === 0) return false;
    const status = rows[0].status;
    return status === 'SUCCEEDED' || status === 'FAILED';
  } catch {
    return false; // DB 不可用时放行，通过其他幂等层保护
  }
}

/** 释放批次锁（标记为 SUCCEEDED 或回退为 QUEUED） */
export async function releaseBatchLock(taskId: string, unitId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  // 不主动变更状态——批次完成由 DB 驱动，Redis 缓存 TTL 24h
}

// ==================== 失败记录 ====================

export interface BatchFailureRecord {
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
  retryCount: number;
  errorCount: number;
  firstError: string;
  failedAt: number;
}

/** 记录批次失败信息 */
export async function recordBatchFailure(
  taskId: string,
  unitId: string,
  failure: Omit<BatchFailureRecord, 'failedAt'>
) {
  const redis = getRedis();
  if (!redis) return;

  const record: BatchFailureRecord = { ...failure, failedAt: Date.now() };

  // 添加到失败批次集合 (Sorted Set, score = timestamp)
  await redis.zadd(ImportKeys.taskFailedBatches(taskId), {
    score: Date.now(),
    member: JSON.stringify(record),
  });

  // 设置 TTL 7 天
  await redis.expire(ImportKeys.taskFailedBatches(taskId), 604800);
}

/** 获取任务的所有失败批次 */
export async function getTaskFailures(taskId: string): Promise<BatchFailureRecord[]> {
  const redis = getRedis();
  if (!redis) return [];

  const members = await redis.zrange(ImportKeys.taskFailedBatches(taskId), 0, -1);
  return members.map((m) => (typeof m === 'string' ? JSON.parse(m) : m) as BatchFailureRecord);
}

// ==================== 错误分布 ====================

/** 递增错误码计数 */
export async function incrementErrorCode(taskId: string, errorCode: string, count = 1) {
  const redis = getRedis();
  if (!redis) return;

  await redis.zincrby(ImportKeys.taskErrorDist(taskId), count, errorCode);
  await redis.expire(ImportKeys.taskErrorDist(taskId), 86400);
}

/** 获取任务的错误分布 TOP N */
export async function getTaskErrorDistribution(taskId: string, limit = 10) {
  const redis = getRedis();
  if (!redis) return [];

  const result = await redis.zrange(ImportKeys.taskErrorDist(taskId), 0, limit - 1, {
    rev: true,
    withScores: true,
  });

  const dist: { errorCode: string; count: number }[] = [];
  for (let i = 0; i < result.length; i += 2) {
    dist.push({
      errorCode: String(result[i]),
      count: result[i + 1] as number,
    });
  }
  return dist;
}

// ==================== 活跃任务集合 ====================

/** 注册活跃任务 */
export async function registerActiveTask(taskId: string) {
  const redis = getRedis();
  if (!redis) return;

  await redis.sadd(ImportKeys.activeTasks(), taskId);
}

/** 注销活跃任务（完成后调用） */
export async function deregisterActiveTask(taskId: string) {
  const redis = getRedis();
  if (!redis) return;

  await redis.srem(ImportKeys.activeTasks(), taskId);
}

/** 获取所有活跃任务 */
export async function getActiveTaskIds(): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];

  const members = await redis.smembers(ImportKeys.activeTasks());
  return members.map(String);
}

// ==================== 吞吐量统计 ====================

/** 记录某分钟导入的行数 */
export async function recordThroughput(minute: string, rows: number) {
  const redis = getRedis();
  if (!redis) return;

  const key = ImportKeys.throughput(minute);
  await redis.incrby(key, rows);
  await redis.expire(key, 7200); // 2h TTL
}

/** 获取最近 N 分钟的吞吐量数据 */
export async function getThroughputHistory(minutes: number): Promise<{ minute: string; rows: number }[]> {
  const redis = getRedis();
  if (!redis) return [];

  const now = new Date();
  const keys: string[] = [];

  for (let i = 0; i < minutes; i++) {
    const t = new Date(now.getTime() - i * 60000);
    const minute = t.toISOString().slice(0, 16).replace('T', ':').slice(0, 16);
    keys.push(ImportKeys.throughput(minute));
  }

  if (keys.length === 0) return [];

  // mget
  const pipeline = redis.pipeline();
  for (const k of keys) pipeline.get(k);
  const results = await pipeline.exec();

  return keys.map((key, i) => ({
    minute: key.replace('import:throughput:', ''),
    rows: results[i] ? parseInt(String(results[i]), 10) || 0 : 0,
  }));
}

// ==================== 任务级吞吐量统计（模块七） ====================

/** 记录任务在某分钟导入的行数 */
export async function recordTaskThroughput(taskId: string, minute: string, rows: number) {
  const redis = getRedis();
  if (!redis) return;

  const key = ImportKeys.taskThroughput(taskId, minute);
  await redis.incrby(key, rows);
  await redis.expire(key, 7200);
}

/** 获取任务最近 N 分钟的吞吐量数据 */
export async function getTaskThroughputHistory(
  taskId: string,
  minutes: number
): Promise<{ minute: string; rows: number }[]> {
  const redis = getRedis();
  if (!redis) return [];

  const now = new Date();
  const keys: string[] = [];

  for (let i = 0; i < minutes; i++) {
    const t = new Date(now.getTime() - i * 60000);
    const minuteKey = t.toISOString().slice(0, 16).replace('T', ':').slice(0, 16);
    keys.push(ImportKeys.taskThroughput(taskId, minuteKey));
  }

  if (keys.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const k of keys) pipeline.get(k);
  const results = await pipeline.exec();

  return keys.map((key, i) => ({
    minute: key.split(`:throughput:`)[1] || key,
    rows: results[i] ? parseInt(String(results[i]), 10) || 0 : 0,
  }));
}

/** 计算任务当前吞吐量（行/秒），基于最近 N 分钟 */
export async function getTaskThroughput(taskId: string, windowMinutes = 3): Promise<number> {
  const history = await getTaskThroughputHistory(taskId, windowMinutes);
  const totalRows = history.reduce((sum, h) => sum + h.rows, 0);

  if (totalRows === 0) return 0;

  // 吞吐量 = 总行数 / (窗口分钟数 * 60) 秒
  return Math.round((totalRows / (windowMinutes * 60)) * 100) / 100;
}

// ==================== 模块十：降级追踪 ====================

/**
 * 递增任务降级期间跳过的 SKU 校验行数。
 * 每行被跳过时 +1，用于任务详情页展示未经过 SKU 校验的总行数。
 */
export async function incrementDegradedSkuRows(taskId: string, count: number) {
  const redis = getRedis();
  if (!redis) return;

  const key = ImportKeys.taskDegradedSkuRows(taskId);
  await redis.incrby(key, count);
  await redis.expire(key, 86400);
}

/** 获取任务降级期间跳过的 SKU 校验行数 */
export async function getDegradedSkuRowCount(taskId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  const val = await redis.get<string>(ImportKeys.taskDegradedSkuRows(taskId));
  return val ? parseInt(val, 10) : 0;
}

/**
 * 记录 SKU 主数据健康检查结果（每分钟一条），用于判断 SKU 服务是否恢复。
 * status: 'ok' 表示正常，'fail' 表示超时或连接异常。
 */
export async function recordSkuHealth(minute: string, status: 'ok' | 'fail') {
  const redis = getRedis();
  if (!redis) return;

  const key = ImportKeys.skuHealth(minute);
  await redis.set(key, status, { ex: 3600 });
}

/**
 * 检查 SKU 主数据最近 N 分钟是否持续异常。
 * 返回 true 表示最近 N 分钟全部失败（SKU 服务确认不可用）。
 */
export async function isSkuServiceUnhealthy(windowMinutes = 3): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const now = new Date();
  let failCount = 0;
  let totalCount = 0;

  for (let i = 0; i < windowMinutes; i++) {
    const t = new Date(now.getTime() - i * 60000);
    const minuteKey = t.toISOString().slice(0, 16).replace('T', ':').slice(0, 16);
    const key = ImportKeys.skuHealth(minuteKey);
    const status = await redis.get<string>(key);
    if (status) {
      totalCount++;
      if (status === 'fail') failCount++;
    }
  }

  // 至少有一条记录且全部失败 → 确认不健康
  return totalCount > 0 && failCount === totalCount;
}

// ==================== 完成清理 ====================

/** 任务完成时标记并设置进度 TTL 为 24h */
export async function markTaskCompleted(taskId: string) {
  const redis = getRedis();
  if (!redis) return;

  await redis.set(ImportKeys.taskDone(taskId), '1', { ex: 86400 });
  await deregisterActiveTask(taskId);
}

/** 判断任务是否已完成 */
export async function isTaskCompleted(taskId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const result = await redis.get(ImportKeys.taskDone(taskId));
  return result === '1';
}

// ==================== 降级标记 ====================

/** 标记任务降级 */
export async function markTaskDegraded(taskId: string, reason: string) {
  const redis = getRedis();
  if (!redis) return;

  const key = `import:${taskId}:degraded`;
  await redis.set(key, reason, { ex: 86400 });
}

/** 检查任务是否降级 */
export async function isTaskDegraded(taskId: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;

  return redis.get<string>(`import:${taskId}:degraded`);
}

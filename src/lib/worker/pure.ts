/**
 * Worker 纯函数集合（无 DB / Redis / 网络依赖，便于自动化测试）
 *
 * 考试要求的相关行为均在此收敛为可单测的纯逻辑：
 * - 错误码映射（E001-E008）
 * - 最终状态判定（partial_success）
 * - 卡死恢复决策（重投 / 标记失败）
 */

export type ImportStatus = "pending" | "processing" | "completed" | "partial_success" | "failed" | "degraded";

/**
 * 根据失败行数判定任务最终状态（考试要求：部分失败 → partial_success）
 */
export function resolveFinalStatus(
  failedRows: number
): "completed" | "partial_success" {
  return failedRows > 0 ? "partial_success" : "completed";
}

/**
 * 格式校验错误 → 错误码映射（考试要求：E001-E008 错误码体系）
 * - E002: 必填缺失（A/B组至少填一组、SKU编码/名称/数量必填）
 * - E003: 电话格式错误
 * - E004: 数量必须为正数
 * - E005: 外部编码重复
 */
export function mapFormatErrorToCode(field: string): string {
  if (field === "receiverPhone") return "E003";
  if (field === "externalCode") return "E005";
  if (field.endsWith("].quantity")) return "E004";
  return "E002"; // 默认：必填缺失
}

/**
 * SKU 校验错误码：主数据不存在（E001）
 */
export const SKU_NOT_FOUND_CODE = "E001";

/**
 * 卡死恢复决策：retryCount 未达上限 → 重投；已达上限 → 标记失败
 */
export type RecoveryAction = "re-enqueue" | "mark-failed";

export function decideRecoveryAction(
  retryCount: number,
  maxRetries: number = 3
): RecoveryAction {
  return retryCount < maxRetries ? "re-enqueue" : "mark-failed";
}

/**
 * 将（1-indexed 展示行）分片范围格式化为 [start, end] 闭区间
 */
export function shardRowRange(
  startRow: number,
  endRow: number
): { startRow: number; endRow: number } {
  return { startRow, endRow };
}

/**
 * 批量大小策略（考试要求：批量写入，禁止逐行 INSERT）
 */
export function batchSlices<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * 从（去重后）SKU 集合判断某行是否存在非法 SKU（用于单元测试降级逻辑）
 */
export function findInvalidSkus(
  skus: string[],
  validSkuSet: Set<string>
): string[] {
  const invalid: string[] = [];
  for (const s of skus) {
    if (s && validSkuSet.size > 0 && !validSkuSet.has(s)) {
      invalid.push(s);
    }
  }
  return invalid;
}

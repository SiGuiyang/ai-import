/**
 * SKU 校验降级机制
 *
 * 当 sku_master 批量查询出现以下情况时，自动降级跳过 SKU 校验：
 * - 查询超时 ≥ 3 秒
 * - sku_master 表异常（连接超时等）
 *
 * 降级模式下仅做格式校验（必填、类型等）
 */

const SKU_VALIDATION_TIMEOUT_MS = 3000;

/**
 * 检查 SKU 校验是否超时
 */
export function isSkuValidationTimeout(startTime: number): boolean {
  return Date.now() - startTime >= SKU_VALIDATION_TIMEOUT_MS;
}

/**
 * 降级原因类型
 */
export type DegradationReason =
  | "sku_query_timeout"
  | "sku_table_error"
  | "sku_query_error";

/**
 * 构建降级描述
 */
export function buildDegradationMessage(reason: DegradationReason): string {
  switch (reason) {
    case "sku_query_timeout":
      return `SKU master query timeout (>${SKU_VALIDATION_TIMEOUT_MS}ms), switching to format-only validation`;
    case "sku_table_error":
      return "SKU master table unavailable, switching to format-only validation";
    case "sku_query_error":
      return "SKU master query error, switching to format-only validation";
  }
}

export type FileType = 'excel' | 'word' | 'pdf';

export type SheetMode = 'first' | 'all' | 'named' | 'index';

export type SourceType = 'column' | 'row' | 'value';

export interface ColumnMapping {
  targetField: string;
  sourceType: SourceType;
  sourceKey?: string;
  sourceIndex?: number;
  defaultValue?: string;
  required: boolean;
}

/** 类型转换规则 */
export interface TypeConversion {
  field: string;
  targetType: 'string' | 'number' | 'integer' | 'date' | 'boolean';
  dateFormat?: string;
}

export interface TailExtraction {
  field: string;
  rowMarker: string;
  columnIndex: number;
}

export interface TransposeConfig {
  dimensionHeaders: string[];
  dimensionField: string;
  valueField: string;
  quantityField?: string;
  quantityHeaderRow?: number;
}

export interface CardSplitConfig {
  startMarker: string;
  tableRowsAfterMarker: number;
  headerRowIndex?: number;
}

export interface CellSplitConfig {
  column: string;
  pattern: string;
  targetFields: string[];
}

export interface SourceArea {
  sheetMode: SheetMode;
  sheetNames?: string[];
  sheetIndex?: number;
  headerSkipRows: number;
  headerRowIndex: number;
  dataStartRow: number;
  dataEndMarker?: string;
  dataEndRow?: number;
  tailInfoRows?: number;
}

export interface ParseRule {
  id: string;
  name: string;
  fileType: FileType;
  description?: string;
  sourceArea: SourceArea;
  columnMappings: ColumnMapping[];
  typeConversions?: TypeConversion[];
  tailExtractions: TailExtraction[];
  transpose?: TransposeConfig;
  cardSplit?: CardSplitConfig;
  cellSplit?: CellSplitConfig;
  groupBy?: string;
  skipLinesRegex?: string[];
  aiGenerated: boolean;
  confidence?: number;
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  externalCode: string;
  receiverStore?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec?: string;
  remark?: string;
  batchId: string;
  rowIndex: number;
  createdAt: string;
}

export interface ParseResult {
  success: boolean;
  data: Record<string, unknown>[];
  errors: string[];
  fileName: string;
  totalRows: number;
  parseTime: number;
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface BatchSubmitResult {
  success: boolean;
  totalCount: number;
  successCount: number;
  failCount: number;
  errors: string[];
  batchId: string;
}

export interface StoredOrder {
  id: string;
  external_code?: string;
  line_no: number;
  receiver_store?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  sku_code: string;
  sku_name: string;
  sku_quantity: number;
  sku_spec?: string;
  remark?: string;
  batch_id: string;
  created_at: string;
}

// ============ V2 异步重构新增类型 ============

/** SKU 主数据 */
export interface SkuMaster {
  id: string;
  skuCode: string;
  name: string;
  spec: string;
  unit: string;
  createdAt: string;
}

/** 导入任务状态 */
export type ImportTaskStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL_SUCCESS'
  | 'FAILED';

/** 处理单元状态 */
export type BatchStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED';

/** 导入任务 */
export interface ImportTask {
  id: string;
  fileName: string;
  fileUrl?: string;
  ruleId: string;
  status: ImportTaskStatus;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalBatches: number;
  completedBatches: number;
  traceId: string;
  degraded: boolean;
  degradedReason?: string;
  contentHash?: string;
  createdAt: string;
  completedAt?: string;
}

/** 处理单元 */
export interface ImportTaskBatch {
  id: string;
  taskId: string;
  unitId: string;
  batchIndex: number;
  startRow: number;
  endRow: number;
  status: BatchStatus;
  version: number;
  retryCount: number;
  lockedAt?: string;
  completedAt?: string;
  traceId: string;
}

/** 行级错误明细 */
export interface ImportTaskError {
  id: string;
  taskId: string;
  unitId: string;
  batchIndex: number;
  rowNumber: number;
  fieldName: string;
  rawValue: string;
  errorCode: string;
  errorReason: string;
  suggestedFix?: string;
  traceId: string;
  createdAt: string;
}

/** 事件信封 */
export interface EventEnvelope {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  aggregateId: string;
  traceId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Outbox 事件 */
export interface OutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SUCCEEDED';
  retryCount: number;
  nextRetryAt?: string;
  createdAt: string;
  sentAt?: string;
}

/** 处理单元性能日志 */
export interface BatchPerformanceLog {
  id: string;
  taskId: string;
  unitId: string;
  batchIndex: number;
  parseDurationMs: number;
  ruleDurationMs: number;
  validateDurationMs: number;
  insertDurationMs: number;
  totalDurationMs: number;
  status: string;
  traceId: string;
}

/** Trace 时间线事件 */
export interface TraceEvent {
  id: string;
  traceId: string;
  taskId?: string;
  unitId?: string;
  eventName: string;
  eventStatus: 'STARTED' | 'SUCCEEDED' | 'FAILED';
  message?: string;
  occurredAt: string;
}

/** 错误码映射 */
export const ERROR_CODES: Record<string, string> = {
  E001: 'SKU 不存在',
  E002: '必填字段缺失',
  E003: '电话格式错误',
  E004: '数量不是正数',
  E005: '外部编码重复',
  E006: '规则映射失败',
  E007: '数据库写入失败',
  E008: '文件格式不支持',
  E009: 'SKU 校验已跳过',
  SYS001: '系统异常',
};

/** 修复建议映射（每个错误码对应具体可操作的修复方式） */
export const SUGGESTED_FIXES: Record<string, string> = {
  E001: '请检查 SKU 编码是否正确，或在商品主数据中创建该 SKU',
  E002: '请补充缺失字段的值后重新导入',
  E003: '请修正为有效的 11 位手机号或带区号的固话号码',
  E004: '请将数量修改为正整数（≥ 1）',
  E005: '请为每个外部编码只保留一行，多个 SKU 请使用不同的行',
  E006: '请检查映射规则的字段名、类型转换和目标类型的匹配关系',
  E007: '请稍后重试导入，如持续失败请联系技术支持',
  E008: '请使用支持的格式：.xlsx、.xls、.docx',
  E009: 'SKU 主数据服务异常，已跳过校验，请在服务恢复后对相关数据执行补校验',
  SYS001: '系统处理异常，请稍后重试或联系技术支持查看链路追踪',
};

/** 敏感字段列表（phone / idcard / name 等应在 raw_value 中脱敏） */
export const SENSITIVE_FIELDS = new Set([
  'receiver_phone',
  'phone',
  'mobile',
  'tel',
  'receiver_name',
  'id_card',
  'id_number',
  'address',
  'receiver_address',
  'email',
  'bank_account',
]);

/** 上传接口响应 */
export interface UploadResponse {
  taskId: string;
  traceId: string;
  status: ImportTaskStatus;
  totalRows: number;
  totalBatches: number;
}

/** 任务进度响应 */
export interface TaskProgressResponse {
  taskId: string;
  fileName: string;
  status: ImportTaskStatus;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalBatches: number;
  completedBatches: number;
  degraded: boolean;
  degradedReason?: string;
  /** 跳过 SKU 校验的行数 */
  degradedSkuRows: number;
  traceId: string;
  createdAt: string;
  completedAt?: string;
  /** 当前吞吐量：行/秒 */
  throughput: number;
  /** 预计剩余时间：秒（任务完成则为 0） */
  estimatedRemainingSec: number;
}

/** 监控摘要 */
export interface MonitorSummary {
  throughput: { minute: string; rows: number }[];
  queueDepth: number;
  stageDistribution: {
    stage: string;
    p50: number;
    p95: number;
    p99: number;
  }[];
  errorDistribution: {
    errorCode: string;
    errorName: string;
    count: number;
  }[];
  slowBatches: BatchPerformanceLog[];
  recentTasks: ImportTask[];
}

// ============ 模块九：全链路 Trace 搜索 ============

/** Trace 搜索参数 */
export interface TraceSearchParams {
  taskId?: string;
  fileName?: string;
  batchIndex?: number;
  rowFrom?: number;
  rowTo?: number;
  errorCode?: string;
  page?: number;
  pageSize?: number;
}

/** Trace 搜索结果项 */
export interface TraceSearchResult {
  traceId: string;
  taskId: string;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  totalErrors: number;
  totalBatches: number;
  createdAt: string;
  completedAt?: string;
}

/** 错误详情（含完整上下文，用于失败节点点击弹窗） */
export interface ErrorDetail {
  id: string;
  batchIndex: number;
  rowNumber: number;
  fieldName: string;
  rawValueMasked: string;
  rawValue: string;
  errorCode: string;
  errorName: string;
  errorReason: string;
  suggestedFix: string;
  traceId: string;
  unitId: string;
  taskId: string;
  /** 所属解析规则名称 */
  ruleName?: string;
  /** 各阶段耗时（ms） */
  stageDurations?: {
    parseMs: number;
    ruleMs: number;
    validateMs: number;
    insertMs: number;
    totalMs: number;
  };
  /** 是否已重试 */
  retried: boolean;
  retryCount: number;
  createdAt: string;
}

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
  status: 'PENDING' | 'SENT' | 'FAILED';
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
};

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
  traceId: string;
  createdAt: string;
  completedAt?: string;
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

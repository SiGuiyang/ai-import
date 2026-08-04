import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============ 解析规则表 ============
export const parsingRules = pgTable("parsing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  steps: jsonb("steps").notNull().$type<any[]>(),
  fieldMapping: jsonb("field_mapping").notNull().$type<any>(),
  createdByLlm: boolean("created_by_llm").default(false),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============ 文件导入记录表 ============
export const fileImports = pgTable("file_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 10 }).notNull(),
  fileSize: integer("file_size").notNull(),
  fileUrl: text("file_url"),
  ruleId: uuid("rule_id"),
  status: varchar("status", { length: 20 }).notNull().default("uploading"),
  totalRows: integer("total_rows").default(0),
  parsedRows: integer("parsed_rows").default(0),
  rawContent: jsonb("raw_content"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============ 出库单表 ============
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalCode: varchar("external_code", { length: 255 }),
  importId: uuid("import_id").notNull(),
  taskId: uuid("task_id"),
  // A组：门店模式
  storeName: varchar("store_name", { length: 500 }),
  // B组：收件人模式
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 50 }),
  receiverAddress: text("receiver_address"),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("orders_task_id_idx").on(table.taskId),
  index("orders_external_code_idx").on(table.externalCode),
]);

// ============ SKU 明细表 ============
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  skuCode: varchar("sku_code", { length: 255 }).notNull(),
  skuName: varchar("sku_name", { length: 500 }).notNull(),
  quantity: integer("quantity").notNull(),
  specification: varchar("specification", { length: 500 }),
  sortOrder: integer("sort_order").default(0),
  lineNo: integer("line_no"),
});

// ============ 开放应用状态枚举 ============
export const appStatusEnum = pgEnum("app_status", ["active", "disabled"]);

// ============ 开放应用表 ============
export const openApps = pgTable("open_apps", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  appId: varchar("app_id", { length: 100 }).notNull().unique(),
  appSecret: varchar("app_secret", { length: 255 }).notNull(),
  description: text("description"),
  status: appStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============ V4 新表 ============

// ============ 导入任务状态枚举 ============
export const importTaskStatusEnum = pgEnum("import_task_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "degraded",
]);

// ============ 处理单元状态枚举 ============
export const shardStatusEnum = pgEnum("shard_status", [
  "pending",
  "locked",
  "completed",
  "failed",
  "skipped",
]);

// ============ 出箱事件状态枚举 ============
export const outboxStatusEnum = pgEnum("outbox_status", [
  "pending",
  "sent",
  "failed",
]);

// ============ SKU 主数据表 ============
export const skuMaster = pgTable("sku_master", {
  id: uuid("id").defaultRandom().primaryKey(),
  skuCode: varchar("sku_code", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 500 }).notNull(),
  spec: varchar("spec", { length: 500 }),
  unit: varchar("unit", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("sku_master_code_idx").on(table.skuCode),
]);

// ============ 导入任务主表 ============
export const importTasks = pgTable("import_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 20 }),
  fileData: text("file_data"),
  ruleId: uuid("rule_id"),
  status: importTaskStatusEnum("status").notNull().default("pending"),
  totalRows: integer("total_rows").notNull().default(0),
  processedRows: integer("processed_rows").notNull().default(0),
  successRows: integer("success_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  totalShards: integer("total_shards").notNull().default(0),
  completedShards: integer("completed_shards").notNull().default(0),
  traceId: varchar("trace_id", { length: 64 }),
  degraded: boolean("degraded").default(false),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("import_tasks_trace_idx").on(table.traceId),
  index("import_tasks_status_idx").on(table.status),
  index("import_tasks_created_idx").on(table.createdAt),
]);

// ============ 处理单元状态表（分片） ============
export const importTaskShards = pgTable("import_task_shards", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull(),
  shardIndex: integer("shard_index").notNull(),
  startRow: integer("start_row").notNull(),
  endRow: integer("end_row").notNull(),
  status: shardStatusEnum("status").notNull().default("pending"),
  retryCount: integer("retry_count").default(0),
  lockedAt: timestamp("locked_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("shards_task_shard_uniq").on(table.taskId, table.shardIndex),
  index("shards_task_id_idx").on(table.taskId),
  index("shards_status_idx").on(table.status),
]);

// ============ 行级错误明细表 ============
export const importTaskErrors = pgTable("import_task_errors", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull(),
  shardIndex: integer("shard_index"),
  rowNumber: integer("row_number").notNull(),
  fieldName: varchar("field_name", { length: 255 }),
  rawValue: text("raw_value"),
  errorCode: varchar("error_code", { length: 100 }).notNull(),
  errorReason: text("error_reason").notNull(),
  traceId: varchar("trace_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("errors_task_idx").on(table.taskId),
  index("errors_code_idx").on(table.errorCode),
  index("errors_row_idx").on(table.rowNumber),
]);

// ============ 本地可靠事件出箱表 ============
export const eventOutbox = pgTable("event_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  aggregateId: varchar("aggregate_id", { length: 255 }).notNull(),
  eventType: varchar("event_type", { length: 255 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: outboxStatusEnum("status").notNull().default("pending"),
  retryCount: integer("retry_count").default(0),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
}, (table) => [
  index("outbox_status_idx").on(table.status),
  index("outbox_created_idx").on(table.createdAt),
]);

// ============ 批次处理性能日志表 ============
export const batchPerformanceLog = pgTable("batch_performance_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull(),
  shardIndex: integer("shard_index").notNull(),
  parseDurationMs: integer("parse_duration_ms"),
  ruleDurationMs: integer("rule_duration_ms"),
  validateDurationMs: integer("validate_duration_ms"),
  insertDurationMs: integer("insert_duration_ms"),
  totalDurationMs: integer("total_duration_ms").notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  rowCount: integer("row_count").notNull(),
  traceId: varchar("trace_id", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("perf_task_idx").on(table.taskId),
  index("perf_created_idx").on(table.createdAt),
]);

// ============ 链路时间线事件表 ============
export const traceEvents = pgTable("trace_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  traceId: varchar("trace_id", { length: 64 }).notNull(),
  taskId: uuid("task_id"),
  shardIndex: integer("shard_index"),
  eventName: varchar("event_name", { length: 255 }).notNull(),
  eventStatus: varchar("event_status", { length: 50 }).notNull().default("ok"),
  message: text("message"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => [
  index("trace_trace_id_idx").on(table.traceId),
  index("trace_task_id_idx").on(table.taskId),
  index("trace_occurred_idx").on(table.occurredAt),
]);

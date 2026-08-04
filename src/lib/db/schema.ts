import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
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
});

// ============ SKU 明细表 ============
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  skuCode: varchar("sku_code", { length: 255 }).notNull(),
  skuName: varchar("sku_name", { length: 500 }).notNull(),
  quantity: integer("quantity").notNull(),
  specification: varchar("specification", { length: 500 }),
  sortOrder: integer("sort_order").default(0),
});

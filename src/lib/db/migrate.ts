import { neon } from "@neondatabase/serverless";

/**
 * 建表 SQL 语句（使用 IF NOT EXISTS，表已存在则跳过）
 * 与 src/lib/db/schema.ts 保持同步
 */
const MIGRATION_SQLS: string[] = [
  // ========== 枚举类型 ==========
  `DO $$ BEGIN CREATE TYPE app_status AS ENUM ('active', 'disabled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE import_task_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'degraded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE shard_status AS ENUM ('pending', 'locked', 'completed', 'failed', 'skipped'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE outbox_status AS ENUM ('pending', 'sent', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ========== 解析规则表 ==========
  `CREATE TABLE IF NOT EXISTS parsing_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    steps JSONB NOT NULL,
    field_mapping JSONB NOT NULL,
    created_by_llm BOOLEAN DEFAULT false,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 文件导入记录表 ==========
  `CREATE TABLE IF NOT EXISTS file_imports (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(10) NOT NULL,
    file_size INTEGER NOT NULL,
    file_url TEXT,
    rule_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading',
    total_rows INTEGER DEFAULT 0,
    parsed_rows INTEGER DEFAULT 0,
    raw_content JSONB,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 出库单表 ==========
  `CREATE TABLE IF NOT EXISTS orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    external_code VARCHAR(255),
    import_id UUID NOT NULL,
    task_id UUID,
    store_name VARCHAR(500),
    receiver_name VARCHAR(255),
    receiver_phone VARCHAR(50),
    receiver_address TEXT,
    remark TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== SKU 明细表 ==========
  `CREATE TABLE IF NOT EXISTS order_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL,
    sku_code VARCHAR(255) NOT NULL,
    sku_name VARCHAR(500) NOT NULL,
    quantity INTEGER NOT NULL,
    specification VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    line_no INTEGER
  )`,

  // ========== 开放应用表 ==========
  `CREATE TABLE IF NOT EXISTS open_apps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    app_id VARCHAR(100) NOT NULL UNIQUE,
    app_secret VARCHAR(255) NOT NULL,
    description TEXT,
    status app_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== SKU 主数据表 ==========
  `CREATE TABLE IF NOT EXISTS sku_master (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    sku_code VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(500) NOT NULL,
    spec VARCHAR(500),
    unit VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 导入任务主表 ==========
  `CREATE TABLE IF NOT EXISTS import_tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    file_type VARCHAR(20),
    file_data TEXT,
    rule_id UUID,
    status import_task_status NOT NULL DEFAULT 'pending',
    total_rows INTEGER NOT NULL DEFAULT 0,
    processed_rows INTEGER NOT NULL DEFAULT 0,
    success_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    total_shards INTEGER NOT NULL DEFAULT 0,
    completed_shards INTEGER NOT NULL DEFAULT 0,
    trace_id VARCHAR(64),
    degraded BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
  )`,

  // ========== 处理单元状态表（分片） ==========
  `CREATE TABLE IF NOT EXISTS import_task_shards (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL,
    shard_index INTEGER NOT NULL,
    start_row INTEGER NOT NULL,
    end_row INTEGER NOT NULL,
    status shard_status NOT NULL DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    locked_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 行级错误明细表 ==========
  `CREATE TABLE IF NOT EXISTS import_task_errors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL,
    shard_index INTEGER,
    row_number INTEGER NOT NULL,
    field_name VARCHAR(255),
    raw_value TEXT,
    error_code VARCHAR(100) NOT NULL,
    error_reason TEXT NOT NULL,
    trace_id VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 本地可靠事件出箱表 ==========
  `CREATE TABLE IF NOT EXISTS event_outbox (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    status outbox_status NOT NULL DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    sent_at TIMESTAMP
  )`,

  // ========== 批次处理性能日志表 ==========
  `CREATE TABLE IF NOT EXISTS batch_performance_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID NOT NULL,
    shard_index INTEGER NOT NULL,
    parse_duration_ms INTEGER,
    rule_duration_ms INTEGER,
    validate_duration_ms INTEGER,
    insert_duration_ms INTEGER,
    total_duration_ms INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    row_count INTEGER NOT NULL,
    trace_id VARCHAR(64),
    created_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 链路时间线事件表 ==========
  `CREATE TABLE IF NOT EXISTS trace_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL,
    task_id UUID,
    shard_index INTEGER,
    event_name VARCHAR(255) NOT NULL,
    event_status VARCHAR(50) NOT NULL DEFAULT 'ok',
    message TEXT,
    metadata JSONB,
    occurred_at TIMESTAMP DEFAULT NOW() NOT NULL
  )`,

  // ========== 索引 ==========
  `CREATE INDEX IF NOT EXISTS orders_task_id_idx ON orders(task_id)`,
  `CREATE INDEX IF NOT EXISTS orders_external_code_idx ON orders(external_code)`,
  `CREATE INDEX IF NOT EXISTS sku_master_code_idx ON sku_master(sku_code)`,
  `CREATE INDEX IF NOT EXISTS import_tasks_trace_idx ON import_tasks(trace_id)`,
  `CREATE INDEX IF NOT EXISTS import_tasks_status_idx ON import_tasks(status)`,
  `CREATE INDEX IF NOT EXISTS import_tasks_created_idx ON import_tasks(created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shards_task_shard_uniq ON import_task_shards(task_id, shard_index)`,
  `CREATE INDEX IF NOT EXISTS shards_task_id_idx ON import_task_shards(task_id)`,
  `CREATE INDEX IF NOT EXISTS shards_status_idx ON import_task_shards(status)`,
  `CREATE INDEX IF NOT EXISTS errors_task_idx ON import_task_errors(task_id)`,
  `CREATE INDEX IF NOT EXISTS errors_code_idx ON import_task_errors(error_code)`,
  `CREATE INDEX IF NOT EXISTS errors_row_idx ON import_task_errors(row_number)`,
  `CREATE INDEX IF NOT EXISTS outbox_status_idx ON event_outbox(status)`,
  `CREATE INDEX IF NOT EXISTS outbox_created_idx ON event_outbox(created_at)`,
  `CREATE INDEX IF NOT EXISTS perf_task_idx ON batch_performance_log(task_id)`,
  `CREATE INDEX IF NOT EXISTS perf_created_idx ON batch_performance_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS trace_trace_id_idx ON trace_events(trace_id)`,
  `CREATE INDEX IF NOT EXISTS trace_task_id_idx ON trace_events(task_id)`,
  `CREATE INDEX IF NOT EXISTS trace_occurred_idx ON trace_events(occurred_at)`,
];

/**
 * 项目启动时初始化数据库表
 * 使用 CREATE IF NOT EXISTS，若表/索引已存在则跳过，不存在则创建
 */
export async function initializeDatabase() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn(
      "[DB Init] DATABASE_URL is not set, skipping table initialization."
    );
    return;
  }

  try {
    console.log("[DB Init] Checking database tables...");
    const sql = neon(dbUrl);

    for (const query of MIGRATION_SQLS) {
      try {
        await sql(query);
      } catch (err: any) {
        // 依赖枚举类型的表可能因枚举未就绪而失败，记录后继续
        console.warn(`[DB Init] Statement warning: ${err.message}`);
      }
    }

    console.log("[DB Init] Database tables are up to date.");
  } catch (error) {
    console.error("[DB Init] Failed to initialize database tables:", error);
    // 不抛出异常，允许应用在 DB 初始化失败时仍可启动
  }
}

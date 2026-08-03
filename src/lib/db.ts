let sqlInstance: any = null;

export async function getSql() {
  if (sqlInstance) return sqlInstance;
  const { neon } = await import('@neondatabase/serverless');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not configured - using in-memory fallback');
    return createMemoryDb();
  }
  sqlInstance = neon(url);
  return sqlInstance;
}

export async function initDB() {
  const sql = await getSql();
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS parse_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        description TEXT,
        rule_json JSONB NOT NULL,
        ai_generated BOOLEAN DEFAULT false,
        confidence REAL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        external_code TEXT,
        receiver_store TEXT,
        receiver_name TEXT,
        receiver_phone TEXT,
        receiver_address TEXT,
        sku_code TEXT NOT NULL,
        sku_name TEXT NOT NULL,
        sku_quantity INTEGER NOT NULL,
        sku_spec TEXT,
        remark TEXT,
        batch_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_orders_external_code ON orders(external_code)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_orders_receiver_name ON orders(receiver_name)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders(batch_id)
    `;

    // 开放接口鉴权凭据表
    await sql`
      CREATE TABLE IF NOT EXISTS app_credentials (
        app_id TEXT PRIMARY KEY,
        app_secret TEXT NOT NULL,
        app_name TEXT,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // 运单异常状态字段（增量迁移，忽略已存在的列）
    try { await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS exception_status TEXT`; } catch {}
    try { await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS exception_reason TEXT`; } catch {}
    try { await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS exception_time TIMESTAMP`; } catch {}
    try { await sql`CREATE INDEX IF NOT EXISTS idx_orders_exception_status ON orders(exception_status)`; } catch {}

    // ============ V2 异步重构新增表 ============

    // SKU 主数据表
    await sql`
      CREATE TABLE IF NOT EXISTS sku_master (
        id TEXT PRIMARY KEY,
        sku_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        spec TEXT,
        unit TEXT DEFAULT '件',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_sku_master_code ON sku_master(sku_code)`; } catch (e) { /* ignore */ }

    // 导入任务主表
    await sql`
      CREATE TABLE IF NOT EXISTS import_tasks (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_url TEXT,
        rule_id TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        total_rows INTEGER DEFAULT 0,
        processed_rows INTEGER DEFAULT 0,
        success_rows INTEGER DEFAULT 0,
        failed_rows INTEGER DEFAULT 0,
        total_batches INTEGER DEFAULT 0,
        completed_batches INTEGER DEFAULT 0,
        trace_id TEXT NOT NULL,
        degraded BOOLEAN DEFAULT false,
        degraded_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_import_tasks_status ON import_tasks(status, created_at)`; } catch { /* ignore */ }
    await sql`CREATE INDEX IF NOT EXISTS idx_import_tasks_trace ON import_tasks(trace_id)`; } catch { /* ignore */ }

    // 处理单元状态表
    await sql`
      CREATE TABLE IF NOT EXISTS import_task_batches (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        batch_index INTEGER NOT NULL,
        start_row INTEGER NOT NULL,
        end_row INTEGER NOT NULL,
        status TEXT DEFAULT 'PENDING',
        retry_count INTEGER DEFAULT 0,
        locked_at TIMESTAMP,
        completed_at TIMESTAMP,
        trace_id TEXT NOT NULL,
        UNIQUE(task_id, unit_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_batches_task_id ON import_task_batches(task_id)`; } catch { /* ignore */ }

    // 行级错误明细表
    await sql`
      CREATE TABLE IF NOT EXISTS import_task_errors (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        batch_index INTEGER NOT NULL,
        row_number INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        raw_value TEXT,
        error_code TEXT NOT NULL,
        error_reason TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_errors_task_unit ON import_task_errors(task_id, unit_id)`; } catch { /* ignore */ }
    await sql`CREATE INDEX IF NOT EXISTS idx_errors_code ON import_task_errors(error_code)`; } catch { /* ignore */ }

    // 事件 Outbox 表
    await sql`
      CREATE TABLE IF NOT EXISTS event_outbox (
        id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT DEFAULT 'PENDING',
        retry_count INTEGER DEFAULT 0,
        next_retry_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        sent_at TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_outbox_status ON event_outbox(status, next_retry_at)`; } catch { /* ignore */ }

    // 处理单元性能日志表
    await sql`
      CREATE TABLE IF NOT EXISTS batch_performance_log (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        batch_index INTEGER NOT NULL,
        parse_duration_ms INTEGER DEFAULT 0,
        rule_duration_ms INTEGER DEFAULT 0,
        validate_duration_ms INTEGER DEFAULT 0,
        insert_duration_ms INTEGER DEFAULT 0,
        total_duration_ms INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_perf_task_unit ON batch_performance_log(task_id, unit_id)`; } catch { /* ignore */ }

    // 链路时间线事件表
    await sql`
      CREATE TABLE IF NOT EXISTS trace_events (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        task_id TEXT,
        unit_id TEXT,
        event_name TEXT NOT NULL,
        event_status TEXT NOT NULL,
        message TEXT,
        occurred_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_trace_trace_id ON trace_events(trace_id, occurred_at)`; } catch { /* ignore */ }
    await sql`CREATE INDEX IF NOT EXISTS idx_trace_task_id ON trace_events(task_id)`; } catch { /* ignore */ }

    // 导入原始数据表
    await sql`
      CREATE TABLE IF NOT EXISTS import_task_raw_data (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        raw_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_raw_data_task_row ON import_task_raw_data(task_id, row_index)`; } catch { /* ignore */ }

  } catch (e) {
    console.warn('DB init failed, using in-memory fallback:', e);
  }
}

function createMemoryDb() {
  const tables: Record<string, any[]> = {
    orders: [],
    parse_rules: [],
  };

  return {
    async query(text: string, params?: any[]) {
      return { rows: [], rowCount: 0 };
    },
    async rawQuery(text: string) {
      return [];
    },
    async insert(table: string, data: any) {
      if (!tables[table]) tables[table] = [];
      tables[table].push(data);
      return data;
    },
    async select(table: string, where?: (item: any) => boolean) {
      if (!tables[table]) return [];
      if (where) return tables[table].filter(where);
      return tables[table];
    },
  };
}

export default getSql;

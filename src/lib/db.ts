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

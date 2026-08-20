import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

/**
 * 数据库驱动说明：
 * - 使用 @neondatabase/serverless 的 Pool（WebSocket 驱动）+ drizzle-orm/neon-serverless
 * - 支持 db.transaction()（事务），满足考试"Outbox 同事务可靠投递"要求
 * - 注意：不要回退到不支持事务的 HTTP 驱动（见 tests/architecture-guards.test.ts）
 */
let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Please configure it in .env.local");
    }
    _pool = new Pool({ connectionString: url });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

// Proxy that lazily initializes the actual db instance
export const db = new Proxy({} as any, {
  get(_target: any, prop: string | symbol) {
    const real = getDb();
    const value = (real as any)[prop];
    if (typeof value === "function") {
      return value.bind(real);
    }
    return value;
  },
});

/**
 * 关闭连接池（测试/脚本结束时可调用）
 */
export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

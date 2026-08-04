import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Please configure it in .env.local");
    }
    const sql = neon(url);
    _db = drizzle(sql, { schema });
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





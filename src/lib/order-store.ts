/**
 * 运单查询辅助（模块5: 跨任务外部编码去重）
 * 使用 orders 表的 external_code 字段
 */
import { initDB, getSql } from './db';

export async function getOrderByExternalCodes(codes: string[]): Promise<Record<string, unknown>[]> {
  if (!codes.length) return [];

  await initDB();
  const sql = await getSql();

  try {
    const result = await sql`
      SELECT external_code, id FROM orders
      WHERE external_code = ANY(${codes})
    `;
    return (result || []) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

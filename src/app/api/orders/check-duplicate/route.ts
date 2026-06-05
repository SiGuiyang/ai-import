import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const codes: string[] = body.codes || [];

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ duplicateCodes: [] });
    }

    await initDB();
    const sql = await getSql();

    // 分批查询，每批最多 500 个
    const batchSize = 500;
    const duplicateCodes: string[] = [];

    for (let i = 0; i < codes.length; i += batchSize) {
      const batch = codes.slice(i, i + batchSize).filter(c => c && c.trim());
      if (batch.length === 0) continue;

      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(',');
      const result = await sql.query(
        `SELECT DISTINCT external_code FROM orders WHERE external_code IN (${placeholders})`,
        batch
      );
      for (const row of result) {
        if (row.external_code) {
          duplicateCodes.push(row.external_code);
        }
      }
    }

    return NextResponse.json({ duplicateCodes });
  } catch (e: any) {
    console.error('check-duplicate error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

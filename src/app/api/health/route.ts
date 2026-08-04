import { NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

/**
 * GET /api/health
 * 健康监测接口，用于判断服务是否正常运行
 */
export async function GET() {
  let dbOk = false;

  try {
    await initDB();
    const sql = await getSql();
    await sql.query('SELECT 1');
    dbOk = true;
  } catch {
    // db not available
  }

  const status = dbOk ? 'ok' : 'degraded';
  const httpStatus = dbOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbOk ? 'connected' : 'disconnected',
      },
    },
    { status: httpStatus }
  );
}

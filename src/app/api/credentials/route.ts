/**
 * GET  /api/credentials  - 凭证列表
 * POST /api/credentials  - 创建新凭证
 * 使用 app_credentials 表 (app_id / app_secret / app_name / active)
 */
import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    await initDB();
    const sql = await getSql();

    const result = await sql`
      SELECT app_id, app_secret, app_name, active, created_at
      FROM app_credentials
      ORDER BY created_at DESC
    `;

    const data = (result || []).map((r: any) => ({
      id: r.app_id,
      name: r.app_name,
      token: r.app_secret,
      apiKey: '',
      enabled: r.active,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ code: 0, data });
  } catch (e) {
    console.error('[Credentials] 查询失败:', e);
    return NextResponse.json({ code: 500, data: [], error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, token, enabled } = body;

    if (!name || !token) {
      return NextResponse.json({ code: 400, error: 'name 和 token 必填' }, { status: 400 });
    }

    await initDB();
    const sql = await getSql();

    const appId = id || uuidv4();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO app_credentials (app_id, app_secret, app_name, active, created_at, updated_at)
      VALUES (${appId}, ${token}, ${name}, ${enabled !== false}, ${now}, ${now})
    `;

    return NextResponse.json({ code: 0, data: { id: appId } });
  } catch (e) {
    console.error('[Credentials] 创建失败:', e);
    return NextResponse.json({ code: 500, error: String(e) }, { status: 500 });
  }
}

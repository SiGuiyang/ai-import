/**
 * PATCH  /api/credentials/[id]  - 切换启用/停用
 * DELETE /api/credentials/[id]  - 删除凭证
 */
import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    await initDB();
    const sql = await getSql();

    if (body.enabled !== undefined) {
      await sql`UPDATE app_credentials SET active = ${body.enabled}, updated_at = NOW() WHERE app_id = ${id}`;
    }

    return NextResponse.json({ code: 0 });
  } catch (e) {
    console.error('[Credentials] 更新失败:', e);
    return NextResponse.json({ code: 500, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await initDB();
    const sql = await getSql();
    await sql`DELETE FROM app_credentials WHERE app_id = ${id}`;
    return NextResponse.json({ code: 0 });
  } catch (e) {
    console.error('[Credentials] 删除失败:', e);
    return NextResponse.json({ code: 500, error: String(e) }, { status: 500 });
  }
}

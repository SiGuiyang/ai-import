import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

/**
 * POST /api/open/credentials
 * 注册开放接口鉴权凭证（管理接口）
 *
 * 请求体：
 *   appId     - 应用ID（必填）
 *   appSecret - 应用密钥（必填，长度至少 16 位）
 *   appName   - 应用名称（可选）
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { appId, appSecret, appName } = body;

    if (!appId || !appSecret) {
      return NextResponse.json(
        { code: 400, message: 'appId 和 appSecret 为必填项' },
        { status: 400 }
      );
    }

    if (typeof appSecret !== 'string' || appSecret.length < 16) {
      return NextResponse.json(
        { code: 400, message: 'appSecret 长度不能少于 16 位' },
        { status: 400 }
      );
    }

    await initDB();
    const sql = await getSql();

    try {
      await sql`
        INSERT INTO app_credentials (app_id, app_secret, app_name)
        VALUES (${appId}, ${appSecret}, ${appName || null})
        ON CONFLICT (app_id) DO UPDATE SET
          app_secret = EXCLUDED.app_secret,
          app_name = COALESCE(EXCLUDED.app_name, app_credentials.app_name),
          updated_at = NOW()
      `;
    } catch (e) {
      return NextResponse.json(
        { code: 500, message: `注册凭证失败: ${String(e)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      code: 0,
      message: '凭证注册成功',
      data: { appId, appName: appName || '' },
    });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/open/credentials
 * 查询所有已注册的凭证列表（不返回 appSecret）
 */
export async function GET() {
  try {
    await initDB();
    const sql = await getSql();

    let list: any[] = [];
    try {
      list = await sql`
        SELECT app_id, app_secret, app_name, active, created_at, updated_at
        FROM app_credentials ORDER BY created_at DESC
      `;
    } catch {
      list = [];
    }

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: list.map((c) => ({
        appId: c.app_id,
        appSecret: c.app_secret || '',
        appName: c.app_name || '',
        active: c.active,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

/**
 * PUT /api/open/credentials
 * 更新凭证状态（启用/禁用）
 *
 * 请求体：
 *   appId  - 应用ID
 *   active - 是否启用
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { appId, active } = body;

    if (!appId) {
      return NextResponse.json({ code: 400, message: 'appId 为必填项' }, { status: 400 });
    }

    await initDB();
    const sql = await getSql();

    try {
      await sql`
        UPDATE app_credentials SET active = ${!!active}, updated_at = NOW()
        WHERE app_id = ${appId}
      `;
    } catch (e) {
      return NextResponse.json(
        { code: 500, message: `更新失败: ${String(e)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ code: 0, message: '更新成功' });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/open/credentials
 * 删除凭证
 *
 * 请求体：
 *   appId - 应用ID
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { appId } = body;

    if (!appId) {
      return NextResponse.json({ code: 400, message: 'appId 为必填项' }, { status: 400 });
    }

    await initDB();
    const sql = await getSql();

    try {
      await sql`DELETE FROM app_credentials WHERE app_id = ${appId}`;
    } catch (e) {
      return NextResponse.json(
        { code: 500, message: `删除失败: ${String(e)}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ code: 0, message: '删除成功' });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

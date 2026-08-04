import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { verifySign, extractAuthHeaders } from '@/lib/auth';

/**
 * GET /api/open/waybills/[waybillNo]
 * 根据运单号查询运单信息（对外开放接口）
 *
 * 请求头鉴权：
 *   X-App-Id: <appId>
 *   X-Timestamp: <Unix 时间戳（秒）>
 *   X-Sign: HMAC-SHA256(timestamp + appId, appSecret)
 *
 * 路径参数：
 *   waybillNo - 运单号（对应 orders 表的 external_code）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ waybillNo: string }> }
) {
  // 1. 鉴权
  const authHeaders = extractAuthHeaders(req.headers);
  if (!authHeaders) {
    return NextResponse.json(
      { code: 401, message: '缺少鉴权参数，请提供 X-App-Id、X-Timestamp、X-Sign 请求头' },
      { status: 401 }
    );
  }

  const { appId, timestamp, sign } = authHeaders;

  try {
    await initDB();
    const sql = await getSql();

    // 查询 app_credentials
    let credentials: any[];
    try {
      credentials = await sql`
        SELECT app_id, app_secret, active FROM app_credentials WHERE app_id = ${appId}
      `;
    } catch {
      credentials = [];
    }

    if (credentials.length === 0) {
      return NextResponse.json(
        { code: 401, message: 'appId 无效' },
        { status: 401 }
      );
    }

    const cred = credentials[0];
    if (!cred.active) {
      return NextResponse.json(
        { code: 403, message: '该 appId 已被禁用' },
        { status: 403 }
      );
    }

    // 验证签名
    if (!verifySign(appId, timestamp, sign, cred.app_secret)) {
      return NextResponse.json(
        { code: 401, message: '签名验证失败，请检查 X-Timestamp 和 X-Sign' },
        { status: 401 }
      );
    }
  } catch (e) {
    return NextResponse.json({ code: 500, message: '鉴权服务异常' }, { status: 500 });
  }

  // 2. 获取运单号
  const { waybillNo } = await params;

  if (!waybillNo) {
    return NextResponse.json(
      { code: 400, message: '缺少运单号参数' },
      { status: 400 }
    );
  }

  // 3. 查询数据库
  try {
    await initDB();
    const sql = await getSql();

    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT * FROM orders WHERE external_code = ${waybillNo} ORDER BY created_at DESC
      `;
    } catch {
      rows = [];
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { code: 404, message: `运单号 ${waybillNo} 不存在` },
        { status: 404 }
      );
    }

    // 汇总运单信息
    const firstRow = rows[0];
    const waybill = {
      waybillNo,
      receiverStore: firstRow.receiver_store || '',
      receiverName: firstRow.receiver_name || '',
      receiverPhone: firstRow.receiver_phone || '',
      receiverAddress: firstRow.receiver_address || '',
      batchId: firstRow.batch_id || '',
      createdAt: firstRow.created_at || '',
      items: rows.map((row) => ({
        skuCode: row.sku_code,
        skuName: row.sku_name,
        skuQuantity: row.sku_quantity,
        skuSpec: row.sku_spec || '',
        remark: row.remark || '',
      })),
      totalQuantity: rows.reduce((sum, row) => sum + Number(row.sku_quantity || 0), 0),
      skuCount: rows.length,
    };

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: waybill,
    });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

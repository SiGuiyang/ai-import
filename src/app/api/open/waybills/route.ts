import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { verifySign, extractAuthHeaders } from '@/lib/auth';

/**
 * GET /api/open/waybills
 * 分批次查询所有运单数据（对外开放接口）
 *
 * 请求头鉴权：
 *   X-App-Id: <appId>
 *   X-Timestamp: <Unix 时间戳（秒）>
 *   X-Sign: HMAC-SHA256(timestamp + appId, appSecret)
 *
 * 查询参数：
 *   page      - 页码，默认 1
 *   pageSize  - 每页条数，默认 20，最大 100
 *   startDate - 开始日期 (YYYY-MM-DD)，可选
 *   endDate   - 结束日期 (YYYY-MM-DD)，可选
 *   search    - 模糊搜索（运单号/收货人），可选
 */
export async function GET(req: NextRequest) {
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

  // 2. 解析查询参数
  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const offset = (page - 1) * pageSize;

  // 3. 查询数据库
  try {
    await initDB();
    const sql = await getSql();

    const conditions: string[] = [];
    const params: any[] = [];

    if (search) {
      conditions.push(`(external_code ILIKE $${params.length + 1} OR receiver_name ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }
    if (startDate) {
      conditions.push(`created_at >= $${params.length + 1}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`created_at <= $${params.length + 1}`);
      params.push(endDate + ' 23:59:59');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let total = 0;
    let result: any[] = [];

    try {
      const countResult = await sql.query(
        `SELECT COUNT(*) as total FROM orders ${whereClause}`,
        params
      );
      total = Number(countResult[0]?.total || 0);

      result = await sql.query(
        `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, offset]
      );
    } catch {
      result = [];
    }

    // 按运单号（external_code）分组汇总
    const waybillMap: Record<string, any> = {};
    for (const row of result) {
      const code = row.external_code || `__unknown_${row.id}__`;
      if (!waybillMap[code]) {
        waybillMap[code] = {
          waybillNo: code,
          receiverStore: row.receiver_store || '',
          receiverName: row.receiver_name || '',
          receiverPhone: row.receiver_phone || '',
          receiverAddress: row.receiver_address || '',
          batchId: row.batch_id || '',
          createdAt: row.created_at || '',
          items: [],
          totalQuantity: 0,
        };
      }
      waybillMap[code].items.push({
        skuCode: row.sku_code,
        skuName: row.sku_name,
        skuQuantity: row.sku_quantity,
        skuSpec: row.sku_spec || '',
        remark: row.remark || '',
      });
      waybillMap[code].totalQuantity += Number(row.sku_quantity || 0);
    }

    const waybills = Object.values(waybillMap);

    return NextResponse.json({
      code: 0,
      message: 'success',
      data: {
        list: waybills,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

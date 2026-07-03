import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { verifySign, extractAuthHeaders } from '@/lib/auth';

/**
 * POST /api/open/waybills/[waybillNo]/exception-notify
 * 回写运单异常状态（对外开放接口）
 *
 * 请求头鉴权：
 *   X-App-Id: <appId>
 *   X-Timestamp: <Unix 时间戳（秒）>
 *   X-Sign: HMAC-SHA256(timestamp + appId, appSecret)
 *
 * 路径参数：
 *   waybillNo - 运单号（必填）
 *
 * 请求体（JSON）：
 *   exceptionStatus - 异常状态码，如 normal/abnormal/damaged/missing（必填）
 *   exceptionReason - 异常原因描述（必填）
 *   skuCode         - SKU 编码（可选，传入则只回写该 SKU，不传则回写整个运单）
 *   exceptionTime   - 异常发生时间（可选，默认当前时间）
 */
export async function POST(
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

    if (!verifySign(appId, timestamp, sign, cred.app_secret)) {
      return NextResponse.json(
        { code: 401, message: '签名验证失败，请检查 X-Timestamp 和 X-Sign' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json({ code: 500, message: '鉴权服务异常' }, { status: 500 });
  }

  // 2. 解析参数
  const { waybillNo } = await params;

  if (!waybillNo) {
    return NextResponse.json(
      { code: 400, message: '运单号为必填项' },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { code: 400, message: '请求体格式错误，需要 JSON' },
      { status: 400 }
    );
  }

  const { exceptionStatus, exceptionReason, skuCode, exceptionTime } = body;

  if (!exceptionStatus) {
    return NextResponse.json(
      { code: 400, message: 'exceptionStatus 为必填项' },
      { status: 400 }
    );
  }

  if (!exceptionReason) {
    return NextResponse.json(
      { code: 400, message: 'exceptionReason 为必填项' },
      { status: 400 }
    );
  }

  const exTime = exceptionTime || new Date().toISOString();

  // 3. 更新数据库
  try {
    await initDB();
    const sql = await getSql();

    let updatedCount = 0;

    if (skuCode) {
      // 精确更新指定运单+SKU
      const result = await sql`
        UPDATE orders
        SET exception_status = ${exceptionStatus},
            exception_reason = ${exceptionReason},
            exception_time = ${exTime}::timestamp
        WHERE external_code = ${waybillNo} AND sku_code = ${skuCode}
      `;
      updatedCount = result?.rowCount ?? result?.count ?? 0;
    } else {
      // 更新整个运单下所有 SKU
      const result = await sql`
        UPDATE orders
        SET exception_status = ${exceptionStatus},
            exception_reason = ${exceptionReason},
            exception_time = ${exTime}::timestamp
        WHERE external_code = ${waybillNo}
      `;
      updatedCount = result?.rowCount ?? result?.count ?? 0;
    }

    if (updatedCount === 0) {
      const msg = skuCode
        ? `运单号 ${waybillNo} 下未找到 SKU ${skuCode}`
        : `运单号 ${waybillNo} 不存在`;
      return NextResponse.json(
        { code: 404, message: msg },
        { status: 404 }
      );
    }

    // 4. 回写后的数据留存
    let affectedRows: any[] = [];
    try {
      if (skuCode) {
        affectedRows = await sql`
          SELECT external_code, sku_code, sku_name, exception_status, exception_reason, exception_time
          FROM orders WHERE external_code = ${waybillNo} AND sku_code = ${skuCode}
        `;
      } else {
        affectedRows = await sql`
          SELECT external_code, sku_code, sku_name, exception_status, exception_reason, exception_time
          FROM orders WHERE external_code = ${waybillNo}
        `;
      }
    } catch {
      // ignore
    }

    return NextResponse.json({
      code: 0,
      message: '异常状态回写成功',
      data: {
        waybillNo,
        exceptionStatus,
        exceptionReason,
        exceptionTime: exTime,
        updatedCount,
        affectedItems: affectedRows.map((r) => ({
          skuCode: r.sku_code,
          skuName: r.sku_name,
          exceptionStatus: r.exception_status,
          exceptionReason: r.exception_reason,
          exceptionTime: r.exception_time,
        })),
      },
    });
  } catch (e) {
    return NextResponse.json({ code: 500, message: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/orders  - 批量提交运单（模块4: 数据校验 + 模块5: 跨任务去重）
 * GET  /api/orders  - 查询运单列表
 */
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { initDB, getSql } from '@/lib/db';
import { validateRecords } from '@/lib/validators';
import { getOrderByExternalCodes } from '@/lib/order-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items, batchId, taskId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: '缺少运单数据' }, { status: 400 });
    }

    // 模块5: 跨任务外部编码去重
    const existingCodes: string[] = [];
    try {
      const externalCodes = items
        .map((i: any) => i.externalCode)
        .filter((c: string) => c?.trim());
      if (externalCodes.length > 0) {
        const existing = await getOrderByExternalCodes(externalCodes);
        existingCodes.push(...existing.map((o: any) => o.externalCode));
      }
    } catch { /* 不影响主流程 */ }

    // 模块4: 数据校验（含跨任务去重）
    const { errors, groupDuplicateWarning } = validateRecords(items, {
      externalCodes: existingCodes,
    });

    if (errors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `数据校验未通过: ${errors.length} 个错误`,
        errors: errors.slice(0, 50),
        duplicateWarnings: groupDuplicateWarning,
      }, { status: 422 });
    }

    await initDB();
    const sql = await getSql();

    const failList: string[] = [];
    const orderIds: string[] = [];
    const now = new Date().toISOString();
    const finalBatchId = batchId || `BATCH_${Date.now()}`;

    // 逐条插入（可后续优化为批量）
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const orderId = uuidv4();
      try {
        await sql`
          INSERT INTO orders
            (id, external_code, line_no,
             receiver_store, receiver_name, receiver_phone, receiver_address,
             sku_code, sku_name, sku_quantity, sku_spec, remark,
             temperature_layer, weight, pieces, amount, status,
             batch_id, task_id, created_at, updated_at)
          VALUES
            (${orderId}, ${item.externalCode || ''}, ${i + 1},
             ${item.receiverStore || ''}, ${item.receiverName || ''},
             ${item.receiverPhone || ''}, ${item.receiverAddress || ''},
             ${item.skuCode || ''}, ${item.skuName || ''},
             ${Number(item.skuQuantity) || 0}, ${item.skuSpec || ''}, ${item.remark || ''},
             ${item.temperatureLayer || null}, ${Number(item.weight) || null},
             ${Number(item.pieces) || null}, ${Number(item.amount) || null},
             'pending',
             ${finalBatchId}, ${taskId || item.importTaskId || ''},
             ${now}, ${now})
        `;
        orderIds.push(orderId);
      } catch (e) {
        console.error(`[Orders] 插入失败 第${i + 1}行:`, e);
        failList.push(`第${i + 1}行: ${String(e).slice(0, 100)}`);
      }
    }

    return NextResponse.json({
      success: true,
      batchId: finalBatchId,
      totalCount: items.length,
      successCount: items.length - failList.length,
      failCount: failList.length,
      orderIds,
      duplicateWarnings: groupDuplicateWarning,
      errors: failList.length > 0 ? failList : undefined,
    });
  } catch (e) {
    console.error('[Orders] 创建失败:', e);
    return NextResponse.json({
      success: false,
      error: String(e),
      successCount: 0,
      failCount: 0,
      totalCount: 0,
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
    const status = url.searchParams.get('status') || '';
    const search = url.searchParams.get('search') || '';

    await initDB();
    const sql = await getSql();

    let countResult: any;
    let listResult: any;

    const baseFilter = status
      ? sql`status = ${status}`
      : sql`TRUE`;
    const searchFilter = search
      ? sql`AND (external_code ILIKE ${'%' + search + '%'} OR sku_code ILIKE ${'%' + search + '%'} OR receiver_store ILIKE ${'%' + search + '%'})`
      : sql``;

    try {
      const countQ = sql`SELECT COUNT(*) as total FROM orders WHERE ${baseFilter} ${searchFilter}`;
      countResult = await countQ;
    } catch {
      countResult = [{ total: 0 }];
    }

    try {
      listResult = await sql`
        SELECT * FROM orders
        WHERE ${baseFilter} ${searchFilter}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `;
    } catch {
      listResult = [];
    }

    const total = parseInt(String(countResult?.[0]?.total || '0'));
    const list = (listResult || []).map((r: any) => ({
      id: r.id,
      externalCode: r.external_code,
      lineNo: r.line_no,
      skuCode: r.sku_code,
      skuName: r.sku_name,
      skuQuantity: r.sku_quantity,
      skuSpec: r.sku_spec,
      remark: r.remark,
      receiverStore: r.receiver_store,
      receiverName: r.receiver_name,
      receiverPhone: r.receiver_phone,
      receiverAddress: r.receiver_address,
      temperatureLayer: r.temperature_layer,
      weight: r.weight,
      pieces: r.pieces,
      amount: r.amount,
      status: r.status || 'pending',
      batchId: r.batch_id,
      importTaskId: r.task_id,
      createdAt: r.created_at,
    }));

    return NextResponse.json({
      code: 0,
      data: { list, total, page, pageSize },
    });
  } catch (e) {
    console.error('[Orders] 查询失败:', e);
    return NextResponse.json({ code: 500, data: { list: [], total: 0, page: 1, pageSize: 20 }, error: String(e) }, { status: 500 });
  }
}

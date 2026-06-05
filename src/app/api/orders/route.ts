import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items, batchId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items to submit' }, { status: 400 });
    }

    await initDB();
    const sql = await getSql();
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];
    const successItems: any[] = [];

    // 按 externalCode 或 receiverStore 分组生成运单摘要
    const groups: Record<string, any[]> = {};
    for (const item of items) {
      const groupKey = (item.externalCode || item.receiverStore || `__group_${Object.keys(groups).length}__`);
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(item);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const skuQuantity = Number(item.skuQuantity);
        if (!Number.isInteger(skuQuantity) || skuQuantity <= 0) {
          errors.push(`第 ${i + 1} 行: 发货数量必须为正整数，当前值: ${item.skuQuantity}`);
          failCount++;
          continue;
        }

        const id = uuidv4();
        await sql`
          INSERT INTO orders (id, external_code, receiver_store, receiver_name, receiver_phone, receiver_address,
            sku_code, sku_name, sku_quantity, sku_spec, remark, batch_id, created_at)
          VALUES (${id}, ${item.externalCode || null}, ${item.receiverStore || null},
            ${item.receiverName || null}, ${item.receiverPhone || null}, ${item.receiverAddress || null},
            ${item.skuCode}, ${item.skuName}, ${skuQuantity}, ${item.skuSpec || null},
            ${item.remark || null}, ${batchId}, ${new Date().toISOString()})
        `;
        successCount++;
        successItems.push({ id, row: i + 1 });
      } catch (e) {
        errors.push(`第 ${i + 1} 行: ${String(e)}`);
        failCount++;
      }
    }

    // 生成运单分组摘要
    const orderSummary = Object.entries(groups).map(([key, groupItems]) => ({
      groupKey: key === '__nogroup__' ? '未分组' : key,
      storeName: groupItems[0]?.receiverStore || key,
      receiverName: groupItems[0]?.receiverName || '',
      itemCount: groupItems.length,
      totalQuantity: groupItems.reduce((sum, it) => sum + Number(it.skuQuantity || 0), 0),
    }));

    return NextResponse.json({
      success: true,
      totalCount: items.length,
      successCount,
      failCount,
      errors,
      batchId,
      orderSummary,
      groupCount: Object.keys(groups).length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20');
  const batchId = url.searchParams.get('batchId') || '';
  const offset = (page - 1) * pageSize;

  try {
    await initDB();
    const sql = await getSql();

    let result: any[];
    let total = 0;

    try {
      let whereClause = '';
      const params: any[] = [];

      const conditions: string[] = [];
      if (search) {
        conditions.push(`(external_code ILIKE $${params.length + 1} OR receiver_name ILIKE $${params.length + 1} OR sku_name ILIKE $${params.length + 1})`);
        params.push(`%${search}%`);
      }
      if (batchId) {
        conditions.push(`batch_id = $${params.length + 1}`);
        params.push(batchId);
      }

      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(' AND ')}`;
      }

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
      total = 0;
    }

    return NextResponse.json({
      data: result,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

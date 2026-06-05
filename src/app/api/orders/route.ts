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
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await sql`
          INSERT INTO orders (id, external_code, receiver_store, receiver_name, receiver_phone, receiver_address,
            sku_code, sku_name, sku_quantity, sku_spec, remark, batch_id, created_at)
          VALUES (${uuidv4()}, ${item.externalCode || null}, ${item.receiverStore || null},
            ${item.receiverName || null}, ${item.receiverPhone || null}, ${item.receiverAddress || null},
            ${item.skuCode}, ${item.skuName}, ${Number(item.skuQuantity)}, ${item.skuSpec || null},
            ${item.remark || null}, ${batchId}, ${new Date().toISOString()})
        `;
        successCount++;
      } catch (e) {
        errors.push(`Row ${i + 1}: ${String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      totalCount: items.length,
      successCount,
      failCount: items.length - successCount,
      errors,
      batchId,
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
  const offset = (page - 1) * pageSize;

  try {
    await initDB();
    const sql = await getSql();

    let result: any[];
    let total = 0;

    try {
      let whereClause = '';
      const params: any[] = [];

      if (search) {
        whereClause = `WHERE external_code ILIKE $1 OR receiver_name ILIKE $1`;
        params.push(`%${search}%`);
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

import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await initDB();
    const sql = await getSql();
    const result = await sql`SELECT * FROM parse_rules WHERE id = ${id}`;
    if (result.length === 0) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }
    return NextResponse.json(result[0]);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    await initDB();
    const sql = await getSql();
    await sql`
      UPDATE parse_rules 
      SET name = ${body.name}, file_type = ${body.fileType}, description = ${body.description || null}, 
          rule_json = ${JSON.stringify(body)}, ai_generated = ${body.aiGenerated}, 
          confidence = ${body.confidence || null}, updated_at = ${new Date().toISOString()}
      WHERE id = ${id}
    `;
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await initDB();
    const sql = await getSql();
    await sql`DELETE FROM parse_rules WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

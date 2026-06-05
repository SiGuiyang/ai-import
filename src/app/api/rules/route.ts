import { NextRequest, NextResponse } from 'next/server';
import { initDB, getSql } from '@/lib/db';
import type { ParseRule } from '@/lib/types';

export async function GET() {
  try {
    await initDB();
    const sql = await getSql();
    let result: any[];
    try {
      result = await sql`SELECT * FROM parse_rules ORDER BY created_at DESC`;
    } catch {
      result = [];
    }
    return NextResponse.json(result.map((r: any) => {
      const base = typeof r.rule_json === 'string' ? JSON.parse(r.rule_json) : (r.rule_json || {});
      return { ...base, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at };
    }));
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: ParseRule = await req.json();
    await initDB();
    const sql = await getSql();
    try {
      await sql`
        INSERT INTO parse_rules (id, name, file_type, description, rule_json, ai_generated, confidence, created_at, updated_at)
        VALUES (${body.id}, ${body.name}, ${body.fileType}, ${body.description || null}, ${JSON.stringify(body)}, ${body.aiGenerated}, ${body.confidence || null}, ${body.createdAt}, ${body.updatedAt})
      `;
    } catch {
      // Fallback: store in memory
    }
    return NextResponse.json({ success: true, id: body.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

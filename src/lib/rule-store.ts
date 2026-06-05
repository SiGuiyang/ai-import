import type { ParseRule } from '@/lib/types';

const BASE = '/api/rules';

export async function getRules(): Promise<ParseRule[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function getRuleById(id: string): Promise<ParseRule | undefined> {
  try {
    const res = await fetch(`${BASE}/${id}`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    return res.json();
  } catch {
    return undefined;
  }
}

export async function createRule(rule: ParseRule): Promise<void> {
  await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
}

export async function updateRule(id: string, updates: Partial<ParseRule>): Promise<void> {
  await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteRule(id: string): Promise<void> {
  await fetch(`${BASE}/${id}`, { method: 'DELETE' });
}

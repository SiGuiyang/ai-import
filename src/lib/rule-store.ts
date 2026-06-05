import type { ParseRule } from '@/lib/types';

const STORAGE_KEY = 'parse_rules';

export function getRules(): ParseRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRules(rules: ParseRule[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function getRuleById(id: string): ParseRule | undefined {
  return getRules().find(r => r.id === id);
}

export function createRule(rule: ParseRule): void {
  const rules = getRules();
  rules.push(rule);
  saveRules(rules);
}

export function updateRule(id: string, updates: Partial<ParseRule>): void {
  const rules = getRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx !== -1) {
    rules[idx] = { ...rules[idx], ...updates, updatedAt: new Date().toISOString() };
    saveRules(rules);
  }
}

export function deleteRule(id: string): void {
  const rules = getRules().filter(r => r.id !== id);
  saveRules(rules);
}

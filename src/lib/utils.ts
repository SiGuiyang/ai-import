import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateBatchId(): string {
  return `BATCH_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function detectFileType(fileName: string): 'excel' | 'word' | 'pdf' | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (!ext) return null;
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (['docx'].includes(ext)) return 'word';
  if (['pdf'].includes(ext)) return 'pdf';
  return null;
}

export function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

export function isPositiveNumber(val: unknown): boolean {
  const n = Number(val);
  return !isNaN(n) && n > 0;
}

export function isPositiveInteger(val: unknown): boolean {
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

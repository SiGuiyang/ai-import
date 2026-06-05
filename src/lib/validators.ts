import { isValidPhone, isPositiveInteger, isPositiveNumber } from './utils';
import type { ValidationError } from './types';

// 合法的温层值
const VALID_TEMP_LAYERS = ['常温', '冷链', '冷冻', '恒温', 'normal', 'cold_chain', 'frozen', 'constant_temp', '冷藏'];

// 需要校验为正数的数量/重量字段名（含模糊匹配）
const POSITIVE_FIELDS = ['skuQuantity', 'weight', 'pieces', 'quantity', 'amount', 'count'];

interface ValidateOptions {
  externalCodes?: string[];  // existing codes in DB
}

export function validateRecords(
  records: Record<string, unknown>[],
  options?: ValidateOptions
): { errors: ValidationError[]; groupDuplicateWarning: string[] } {
  const errors: ValidationError[] = [];
  const groupDuplicates: string[] = [];
  const seenCodes: Map<string, number> = new Map();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const row = i + 1;

    const store = rec.receiverStore as string;
    const name = rec.receiverName as string;
    const phone = rec.receiverPhone as string;
    const addr = rec.receiverAddress as string;

    const hasGroupA = !!store?.trim();
    const hasGroupB = !!(name?.trim() && phone?.trim() && addr?.trim());

    if (!hasGroupA && !hasGroupB) {
      if (!store?.trim()) {
        errors.push({ row, field: 'receiverStore', message: '收货门店未填写（A组）' });
      }
      if (!name?.trim()) {
        errors.push({ row, field: 'receiverName', message: '收件人姓名未填写（B组）' });
      }
      if (!phone?.trim()) {
        errors.push({ row, field: 'receiverPhone', message: '收件人电话未填写（B组）' });
      }
      if (!addr?.trim()) {
        errors.push({ row, field: 'receiverAddress', message: '收件人地址未填写（B组）' });
      }
    }

    if (hasGroupB && phone?.trim()) {
      if (!isValidPhone(phone.trim())) {
        errors.push({ row, field: 'receiverPhone', message: `电话格式错误: ${phone}` });
      }
    }

    if (hasGroupB && !name?.trim()) {
      errors.push({ row, field: 'receiverName', message: '收件人姓名必填' });
    }
    if (hasGroupB && !addr?.trim()) {
      errors.push({ row, field: 'receiverAddress', message: '收件人地址必填' });
    }

    const skuCode = rec.skuCode as string;
    if (!skuCode?.trim()) {
      errors.push({ row, field: 'skuCode', message: 'SKU编码必填' });
    }

    const skuName = rec.skuName as string;
    if (!skuName?.trim()) {
      errors.push({ row, field: 'skuName', message: 'SKU名称必填' });
    }

    const qty = rec.skuQuantity;
    if (qty === undefined || qty === null || qty === '') {
      errors.push({ row, field: 'skuQuantity', message: '发货数量必填' });
    } else if (!isPositiveInteger(Number(qty))) {
      errors.push({ row, field: 'skuQuantity', message: `发货数量必须为正整数，当前值: ${qty}` });
    }

    // 温层校验：若字段存在则校验合法值
    const tempLayer = rec.temperatureLayer as string | undefined;
    if (tempLayer !== undefined && tempLayer !== null && String(tempLayer).trim()) {
      if (!VALID_TEMP_LAYERS.includes(String(tempLayer).trim())) {
        errors.push({
          row,
          field: 'temperatureLayer',
          message: `温层值"${tempLayer}"不在合法范围内，合法值: ${VALID_TEMP_LAYERS.join('/')}`,
        });
      }
    }

    // 重量/件数等非正数校验
    for (const fld of POSITIVE_FIELDS) {
      const val = rec[fld];
      if (val !== undefined && val !== null && val !== '') {
        if (!isPositiveNumber(Number(val))) {
          errors.push({ row, field: fld, message: `${fld}必须为正数，当前值: ${val}` });
        }
      }
    }

    // 外部编码重复检测（同批次）
    const code = rec.externalCode as string;
    if (code?.trim()) {
      const trimmed = code.trim();
      if (seenCodes.has(trimmed)) {
        groupDuplicates.push(`第${row}行的外部编码"${trimmed}"与本批次第${seenCodes.get(trimmed)}行重复`);
      }
      seenCodes.set(trimmed, row);

      if (options?.externalCodes?.includes(trimmed)) {
        groupDuplicates.push(`第${row}行的外部编码"${trimmed}"与已存在的运单数据重复`);
      }
    }
  }

  return { errors, groupDuplicateWarning: groupDuplicates };
}

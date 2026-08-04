/**
 * 独立的压测 Excel 文件生成脚本
 * 可单独运行，不依赖数据库连接
 *
 * 用法：
 *   npx tsx scripts/generate-test-file.ts
 *   npx tsx scripts/generate-test-file.ts --rows 50000  # 自定义行数
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_ROWS = 10_000;
const SKU_COUNT = 20_000;
const OUTPUT_DIR = path.resolve(__dirname, '..', 'test-data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, '10000-orders.xlsx');

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function generate(rowsCount: number) {
  console.log(`📊 生成 ${rowsCount.toLocaleString()} 行运单压测 Excel...`);
  const start = Date.now();

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const storeNames = ['朝阳店', '海淀店', '西城店', '东城店', '丰台店', '通州店', '大兴店', '昌平店'];
  const receiverNames = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十'];
  const streets = ['中山路', '解放路', '人民路', '建设路', '文化路', '和平路', '光明路', '长安街'];

  const headers = [
    '出库单号',
    '收货门店',
    '收货人',
    '收货电话',
    '收货地址',
    'SKU编码',
    'SKU名称',
    '数量',
    '规格',
    '备注',
  ];

  const rows: string[][] = [headers];

  for (let i = 1; i <= rowsCount; i++) {
    const waybillNo = `PERF-${String(i).padStart(6, '0')}`;
    const skuIndex = (i % SKU_COUNT) + 1;

    let skuCode: string;
    if (i % 500 === 0) {
      skuCode = 'SKU_INVALID_99999';
    } else if (i % 700 === 0) {
      skuCode = '';
    } else {
      skuCode = `SKU_${padNum(skuIndex, 5)}`;
    }

    const store = storeNames[i % storeNames.length];
    const receiver = receiverNames[i % receiverNames.length];

    let phone: string;
    if (i % 900 === 0) {
      phone = '12345';
    } else if (i % 1100 === 0) {
      phone = '';
    } else {
      phone = `138${padNum(i % 100000000, 8)}`;
    }

    const street = streets[i % streets.length];
    const address = `北京市${store.replace('店', '区')}${street}${(i % 200) + 1}号`;

    let quantity: string;
    if (i % 1300 === 0) {
      quantity = '-5';
    } else if (i % 1400 === 0) {
      quantity = '0';
    } else {
      quantity = String((i % 50) + 1);
    }

    rows.push([
      waybillNo,
      store,
      receiver,
      phone,
      address,
      skuCode,
      i % 3 === 0 ? `商品${padNum(skuIndex, 5)}` : '',
      quantity,
      i % 2 === 0 ? '500ml' : '200g',
      i % 100 === 0 ? '加急配送' : '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 15) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '出库单');
  XLSX.writeFile(wb, OUTPUT_FILE);

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`   ✅ 已生成: ${OUTPUT_FILE} (${fileSize} KB, ${((Date.now() - start) / 1000).toFixed(2)}s)`);
  console.log(`   📋 总行数: ${rowsCount}, 数据行: ${rowsCount}`);
}

const rowsCount = parseInt(process.argv.find((a) => a.startsWith('--rows='))?.split('=')[1] || '') || DEFAULT_ROWS;
generate(rowsCount);

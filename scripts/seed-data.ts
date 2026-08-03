/**
 * 压测数据自动准备脚本
 *
 * 功能：
 * 1. 清理旧的压测 SKU 主数据
 * 2. 插入 20,000 条 SKU 主数据（SKU_00001 ~ SKU_20000）
 * 3. 生成 10,000 行运单压测 Excel 文件
 *
 * 用法：
 *   npx tsx scripts/seed-data.ts
 *   npx tsx scripts/seed-data.ts --clean-only   # 仅清理
 *   npx tsx scripts/seed-data.ts --seed-only    # 仅灌入 SKU
 *   npx tsx scripts/seed-data.ts --file-only    # 仅生成 Excel
 */

import { neon } from '@neondatabase/serverless';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============ 配置 ============
const SKU_COUNT = 20_000;
const WAYBILL_ROWS = 10_000;
const BATCH_SIZE = 500; // 每批 INSERT 行数
const SKU_PREFIX = 'SKU_';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'test-data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, '10000-orders.xlsx');

// ============ 工具函数 ============
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ 未设置 DATABASE_URL 环境变量');
    console.error('   请先设置：export DATABASE_URL=postgres://...');
    process.exit(1);
  }
  return url;
}

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(2)}s`;
}

// ============ 清理函数 ============
async function cleanData(sql: ReturnType<typeof neon>) {
  console.log('🧹 清理旧的压测数据...');
  const start = Date.now();

  // 删除旧的运单数据（压测用的外部编码前缀）
  await sql`DELETE FROM orders WHERE external_code LIKE 'PERF-%'`;
  // 清理旧的导入任务相关数据
  await sql`DELETE FROM import_task_errors`;
  await sql`DELETE FROM batch_performance_log`;
  await sql`DELETE FROM trace_events`;
  await sql`DELETE FROM event_outbox`;
  await sql`DELETE FROM import_task_batches`;
  await sql`DELETE FROM import_tasks`;
  // 删除旧的 SKU 主数据
  await sql`DELETE FROM sku_master WHERE sku_code LIKE 'SKU_%'`;

  console.log(`   ✅ 清理完成 (${elapsed(start)})`);
}

// ============ 灌入 SKU 主数据 ============
async function seedSkuMaster(sql: ReturnType<typeof neon>) {
  console.log(`📦 灌入 ${SKU_COUNT.toLocaleString()} 条 SKU 主数据...`);
  const start = Date.now();

  const specs = ['500ml', '1L', '200g', '1kg', '100片', '50ml', '30粒', '60片', '250g', '2.5kg'];
  const units = ['瓶', '袋', '盒', '箱', '桶', '包', '罐', '支', '个', '件'];
  const namePrefixes = ['维生素', '矿物质', '蛋白', '纤维', '益生菌', '鱼油', '钙片', '铁剂', '锌片', '镁片'];

  let inserted = 0;
  const batches: string[][] = [];
  let currentBatch: string[] = [];

  for (let i = 1; i <= SKU_COUNT; i++) {
    const code = `${SKU_PREFIX}${padNum(i, 5)}`;
    const name = `${namePrefixes[i % namePrefixes.length]}${Math.ceil(i / 100)}号`;
    const spec = specs[i % specs.length];
    const unit = units[i % units.length];
    const id = uuidv4();

    currentBatch.push(`('${id}','${code}','${name}','${spec}','${unit}')`);

    if (currentBatch.length >= BATCH_SIZE || i === SKU_COUNT) {
      batches.push(currentBatch);
      currentBatch = [];
    }
  }

  for (let i = 0; i < batches.length; i++) {
    const values = batches[i].join(',');
    try {
      await sql.raw(
        `INSERT INTO sku_master (id, sku_code, name, spec, unit) VALUES ${values} ON CONFLICT (sku_code) DO NOTHING`
      );
      inserted += batches[i].length;
    } catch (e) {
      console.error(`   批次 ${i + 1} 插入失败:`, String(e).slice(0, 100));
    }

    if ((i + 1) % 10 === 0 || i === batches.length - 1) {
      process.stdout.write(`\r   已插入: ${inserted.toLocaleString()} / ${SKU_COUNT.toLocaleString()}`);
    }
  }

  console.log(`\n   ✅ SKU 主数据灌入完成: ${inserted.toLocaleString()} 条 (${elapsed(start)})`);
}

// ============ 生成压测 Excel ============
function generateTestExcel() {
  console.log(`📊 生成 ${WAYBILL_ROWS.toLocaleString()} 行运单压测 Excel...`);
  const start = Date.now();

  // 确保输出目录存在
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

  // 生成 10,000 行，其中故意插入少量非法数据用于错误定位验证
  for (let i = 1; i <= WAYBILL_ROWS; i++) {
    const waybillNo = `PERF-${String(i).padStart(6, '0')}`;
    const skuIndex = (i % SKU_COUNT) + 1; // 循环使用 SKU

    let skuCode: string;
    if (i % 500 === 0) {
      // 故意插入不存在的 SKU (用于验证 E001)
      skuCode = 'SKU_INVALID_99999';
    } else if (i % 700 === 0) {
      // 故意插入空 SKU (用于验证 E002)
      skuCode = '';
    } else {
      skuCode = `${SKU_PREFIX}${padNum(skuIndex, 5)}`;
    }

    const store = storeNames[i % storeNames.length];
    const receiver = receiverNames[i % receiverNames.length];

    // 故意制造少数格式错误的电话 (用于验证 E003)
    let phone: string;
    if (i % 900 === 0) {
      phone = '12345'; // 错误的电话格式
    } else if (i % 1100 === 0) {
      phone = ''; // 缺失电话
    } else {
      phone = `138${padNum(i % 100000000, 8)}`;
    }

    const street = streets[i % streets.length];
    const address = `北京市${store.replace('店', '区')}${street}${(i % 200) + 1}号`;

    let quantity: string;
    if (i % 1300 === 0) {
      quantity = '-5'; // 负数，验证 E004
    } else if (i % 1400 === 0) {
      quantity = '0'; // 零，验证 E004
    } else {
      quantity = String((i % 50) + 1);
    }

    const spec = i % 2 === 0 ? '500ml' : '200g';
    const remark = i % 100 === 0 ? '加急配送' : '';

    rows.push([
      waybillNo,
      store,
      receiver,
      phone,
      address,
      skuCode,
      i % 3 === 0 ? `商品${padNum(skuIndex, 5)}` : '',
      quantity,
      spec,
      remark,
    ]);
  }

  // 写入 Excel
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 设置列宽
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 4, 15) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '出库单');
  XLSX.writeFile(wb, OUTPUT_FILE);

  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log(`   ✅ 压测文件已生成: ${OUTPUT_FILE} (${fileSize} KB, ${elapsed(start)})`);

  // 统计非法数据
  const invalidSkus = rows.filter(
    (r, i) => i > 0 && (r[5] === 'SKU_INVALID_99999' || r[5] === '')
  ).length;
  const invalidPhones = rows.filter(
    (r, i) => i > 0 && (r[3] === '12345' || r[3] === '')
  ).length;
  const invalidQuantities = rows.filter(
    (r, i) => i > 0 && (r[7] === '-5' || r[7] === '0')
  ).length;

  console.log(`   📋 故意插入的错误数据:`);
  console.log(`      - 非法 SKU: ${invalidSkus} 行`);
  console.log(`      - 错误电话: ${invalidPhones} 行`);
  console.log(`      - 非法数量: ${invalidQuantities} 行`);
}

// ============ 主流程 ============
async function main() {
  const args = process.argv.slice(2);
  const cleanOnly = args.includes('--clean-only');
  const seedOnly = args.includes('--seed-only');
  const fileOnly = args.includes('--file-only');
  const runAll = !cleanOnly && !seedOnly && !fileOnly;

  console.log('═══ 压测数据准备工具 ═══\n');

  const shouldClean = runAll || cleanOnly;
  const shouldSeed = runAll || seedOnly;
  const shouldGenFile = runAll || fileOnly;

  if (shouldClean || shouldSeed) {
    const dbUrl = getDatabaseUrl();
    const sql = neon(dbUrl);

    if (shouldClean) {
      await cleanData(sql);
    }
    if (shouldSeed) {
      await seedSkuMaster(sql);
    }
  }

  if (shouldGenFile) {
    generateTestExcel();
  }

  console.log('\n🎉 完成！');
}

main().catch((e) => {
  console.error('❌ 脚本执行失败:', e);
  process.exit(1);
});

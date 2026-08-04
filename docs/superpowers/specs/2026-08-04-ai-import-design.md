# AI 智能文件解析导入系统 - 设计文档

> 创建日期: 2026-08-04
> 状态: Draft

---

## 一、项目概述

物流/快递行业需要频繁批量下单，客户提供的文件格式各异（Excel / Word / PDF），且文档结构复杂（干扰性头部信息、横向排列字段、合并单元格、非标准表格等）。本系统通过 **DSL 规则引擎 + LLM 智能辅助** 实现任意格式文件的智能解析与批量下单。

### 核心设计理念

- **不是为每种文件写硬编码解析逻辑**，而是设计一套通用的规则描述语言 + 多种提取器
- 新增文件格式时，只需"配置一条新规则"，系统代码零改动
- LLM 角色：分析文件结构自动推荐规则 + 辅助解析非结构化区域

### 9 种文件格式兼容

| 文件 | 格式 | 核心难点 | 对应提取器 |
|------|------|----------|-----------|
| 黎明屯配送发货单 | Excel | 尾部横向收货人信息 | standard-table + tail-section |
| 湖南仓发货明细 | Excel | 按配送单号跨行聚合 | standard-table + group-by-external-code |
| 欢乐牧场模板 | Excel | SKU×门店矩阵转置 | matrix-transpose |
| 黔寨寨配送单 | PDF | PDF解析 + 尾部纯文本 | pdf-extract + tail-section |
| 多门店分Sheet出库单 | Excel | 多Sheet合并 | sheet-merge |
| 门店调拨单(卡片式) | Excel | 卡片边界识别 | card-split |
| 门店配送确认单 | Word | 纯文本段落 | text-regex |
| 周配送计划 | Excel | 双重转置+复合单元格 | matrix-transpose + cell-split |
| 配送签收单(多单PDF) | PDF | 多订单PDF拆分 | pdf-split + standard-table |

---

## 二、技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 框架 | Next.js 14 App Router + TypeScript | App Router 天然支持 SSR/SSE/API Routes |
| UI | Ant Design 5 + Tailwind CSS 3 | Ant Design Table 组件强大，Tailwind 微调样式 |
| 主色 | `#0fc6c2` | 鲸天系统统一设计语言 |
| 数据库 | Neon PostgreSQL + Drizzle ORM | Vercel 原生集成，Serverless 友好 |
| 文件解析 | xlsx (SheetJS), mammoth, pdf-parse | 成熟稳定的解析库 |
| 大模型 | OpenAI-compatible API (通义千问等) | `.env` 配置 Key/URL/Model，灵活切换 |
| 部署 | Vercel | 免费额度充足，Edge Functions 支持 |
| 存储 | Vercel Blob / 临时文件 | 上传文件临时存储 |

---

## 三、系统架构

```
┌─────────────────────────────────────────────────────┐
│                   Next.js App Router                 │
├─────────────────────────────────────────────────────┤
│  Layout (Ant Design ConfigProvider + Tailwind)       │
│  主色 #0fc6c2, 圆角卡片, 清爽蓝绿色调                │
├──────────┬──────────┬──────────┬────────────────────┤
│ /rules   │ /import  │ /import  │ /orders            │
│ 规则管理  │ 文件导入  │ /[id]/   │ 运单列表           │
│          │ 解析     │ preview  │                    │
├──────────┴──────────┴──────────┴────────────────────┤
│               API Routes (Route Handlers)           │
├────────────────────┬────────────────────────────────┤
│   解析规则引擎 (DSL) │    AI Service                  │
│   ┌───────────────┐ │   ┌───────────────────────┐   │
│   │ TableExtractor│ │   │ analyzeFileStructure  │   │
│   │ MatrixExtract │ │   │ extractTailSection    │   │
│   │ CardExtractor │ │   │ extractTextField      │   │
│   │ TextExtractor │ │   │ parseNonStructured     │   │
│   │ TailExtractor │ │   └───────────────────────┘   │
│   │ SheetMerger   │ │                                │
│   └───────────────┘ │                                │
├────────────────────┴────────────────────────────────┤
│           Neon PostgreSQL (Drizzle ORM)              │
│           ┌──────────┬──────────┬──────────┐         │
│           │ rules    │ imports  │ orders + │         │
│           │          │          │ items    │         │
│           └──────────┴──────────┴──────────┘         │
└─────────────────────────────────────────────────────┘
```

---

## 四、数据库 Schema

### 4.1 parsing_rules (解析规则表)

```typescript
export const parsingRules = pgTable("parsing_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  steps: jsonb("steps").notNull().$type<ParsingStep[]>(),
  fieldMapping: jsonb("field_mapping").notNull().$type<FieldMapping>(),
  createdByLlm: boolean("created_by_llm").default(false),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### 4.2 file_imports (文件导入记录)

```typescript
export const fileImports = pgTable("file_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 10 }).notNull(), // xlsx|xls|docx|pdf
  fileSize: integer("file_size").notNull(),
  fileUrl: text("file_url"),
  ruleId: uuid("rule_id").references(() => parsingRules.id, { onDelete: "set null" }),
  status: varchar("status", { length: 20 }).notNull().default("uploading"),
  // uploading -> parsing -> parsed -> failed
  totalRows: integer("total_rows").default(0),
  parsedRows: integer("parsed_rows").default(0),
  rawContent: jsonb("raw_content"), // 保存原始解析内容，解析失败时供用户查看
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 4.3 orders (出库单)

```typescript
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalCode: varchar("external_code", { length: 255 }), // 外部编码
  importId: uuid("import_id").references(() => fileImports.id, { onDelete: "cascade" }).notNull(),
  // A组：门店模式
  storeName: varchar("store_name", { length: 500 }),
  // B组：收件人模式
  receiverName: varchar("receiver_name", { length: 255 }),
  receiverPhone: varchar("receiver_phone", { length: 50 }),
  receiverAddress: text("receiver_address"),
  remark: text("remark"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  // draft -> submitted
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 4.4 order_items (SKU 明细)

```typescript
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }).notNull(),
  skuCode: varchar("sku_code", { length: 255 }).notNull(),
  skuName: varchar("sku_name", { length: 500 }).notNull(),
  quantity: integer("quantity").notNull(),
  specification: varchar("specification", { length: 500 }),
  sortOrder: integer("sort_order").default(0),
});
```

---

## 五、解析规则引擎 DSL（核心模块）

### 5.1 规则整体结构

```typescript
interface ParsingRule {
  name: string;
  description?: string;
  steps: ParsingStep[];
  fieldMapping: FieldMapping;
}

interface ParsingStep {
  id: string;
  type: StepType;
  label: string;     // UI 展示名称
  enabled: boolean;
  config: StepConfig;
  // LLM 辅助：当 useLlm=true 时，该步骤的结果由 LLM 提取
  useLlm?: boolean;
}

type StepType =
  | "standard-table"
  | "matrix-transpose"
  | "card-split"
  | "text-regex"
  | "tail-section"
  | "sheet-merge"
  | "cell-split"
  | "group-by";
```

### 5.2 字段映射

```typescript
interface FieldMapping {
  // 数据源字段名 -> 目标下单字段
  externalCode?: FieldSource;     // 外部编码
  storeName?: FieldSource;        // 收货门店 (A组)
  receiverName?: FieldSource;     // 收件人姓名 (B组)
  receiverPhone?: FieldSource;    // 收件人电话
  receiverAddress?: FieldSource;  // 收件人地址
  skuCode: FieldSource;           // SKU编码 (必填)
  skuName: FieldSource;           // SKU名称 (必填)
  quantity: FieldSource;          // 发货数量 (必填)
  specification?: FieldSource;    // 规格型号
  remark?: FieldSource;           // 备注
}

interface FieldSource {
  stepId: string;      // 来自哪个 step
  fieldPath: string;   // 该 step 输出数据中的字段路径
  transform?: string;  // 可选的 transform 函数名
  // 标记是否由AI推测
  aiInferred?: boolean;
  aiConfidence?: "high" | "medium" | "low";
}
```

### 5.3 6 种提取器详设

#### 5.3.1 standard-table（标准表格提取器）

适用于：黎明屯配送单、湖南仓发货明细、黔寨寨配送单、配送签收单

```typescript
interface StandardTableConfig {
  // 数据区域定位
  sheetIndex?: number;           // Sheet 序号 (0-based)，默认 0
  headerRow: number;             // 表头行号 (0-based)
  dataStartRow: number;          // 数据起始行
  dataEndRow?: number;           // 数据结束行 (不含)，不指定则读到空白行
  skipRows?: number[];           // 跳过的行号 (如合计行、空行)
  // 列映射 (列名 -> 输出字段名)
  columnMapping?: Record<string, string>;
  // 忽略的列
  ignoreColumns?: string[];
  // 合并单元格处理
  mergeCellStrategy?: "fill-down" | "skip";
}
```

#### 5.3.2 matrix-transpose（矩阵转置提取器）

适用于：欢乐牧场模板（SKU×门店矩阵）、周配送计划（日期×门店矩阵）

```typescript
interface MatrixTransposeConfig {
  // 行头定位
  rowHeaderStartRow: number;
  rowHeaderStartCol: number;
  rowHeaderEndCol: number;       // 行头结束列
  rowHeaderNames?: string[];     // 行头列名列表 ["SKU编码", "SKU名称", "规格"]
  // 列头定位
  colHeaderRow: number;          // 列头所在行
  colHeaderStartCol: number;     // 列头起始列
  colHeaderName: string;         // 转置后列头的概念名称 (如 "门店", "日期")
  // 数据区域
  dataStartRow: number;          // 数据起始行
  dataEndRow?: number;
  dataStartCol: number;          // 数据起始列
  // 如果是复合单元格（如周配送计划），需要进一步拆分
  cellSplitter?: string;         // 单元格内分隔符 (如 "\n")
  cellValuePattern?: string;     // 单元格值正则 (如 "(\\S+)x(\\d+)")
  cellFieldNames?: string[];     // 拆分后字段名 ["物品名", "数量"]
}
```

#### 5.3.3 card-split（卡片拆分提取器）

适用于：门店调拨单（卡片式）

```typescript
interface CardSplitConfig {
  cardMarker: string;             // 卡片起始标志 (如 "▶ 调拨记录")
  cardMarkerPattern?: string;     // 正则匹配 (如 "▶ 调拨记录 #(\\d+)")
  // 卡片内子表格
  innerTableHeaderRowOffset: number; // 子表表头相对于卡片起始行偏移
  innerTableDataStartOffset: number; // 子表数据相对于卡片起始行偏移
  innerTableEndMarker?: string;      // 子表结束标志
  // 卡片内其他信息区域
  cardFields: CardField[];           // 从卡片中提取的字段
}

interface CardField {
  name: string;                  // 字段名
  rowOffset: number;             // 相对于卡片起始行偏移
  pattern?: string;              // 提取正则
  prefix?: string;               // 前缀匹配 (如 "收货门店：")
}
```

#### 5.3.4 text-regex（纯文本正则提取器）

适用于：门店配送确认单（Word 纯文本）

```typescript
interface TextRegexConfig {
  // 记录分隔
  recordSeparator: string;       // 记录间分隔符 (如 "━━━")
  // 字段提取规则
  fieldPatterns: TextFieldPattern[];
  // 物品列表提取
  itemListPattern: string;       // 物品行正则
  itemFields: string[];          // 物品行解析后字段 ["编码", "名称", "规格", "数量"]
}

interface TextFieldPattern {
  name: string;                  // 字段名
  pattern: string;               // 正则表达式
  group?: number;                // 捕获组 (默认 1)
  multiline?: boolean;           // 是否跨行匹配
}
```

#### 5.3.5 tail-section（尾部信息区提取器）

适用于：黎明屯配送单（横向收货人）、黔寨寨配送单（PDF 尾部）

```typescript
interface TailSectionConfig {
  // 尾部区域定位
  startMarker?: string;          // 尾部起始标志文本
  afterRow?: number;             // 在指定行之后
  afterDataEnd?: boolean;        // 自动跟随数据结束行
  // 提取方式
  extractMode: "horizontal" | "vertical" | "paragraph";
  // 字段模式
  fieldPatterns: TailFieldPattern[];
  // 如果收货人和数据行对应关系不明确
  associationField?: string;     // 关联字段 (如 "外部编码")
}

interface TailFieldPattern {
  name: string;
  prefix?: string;               // 如 "收件人："
  regex?: string;
  rowOffset?: number;
  colOffset?: number;
}
```

#### 5.3.6 sheet-merge（多 Sheet 合并）

适用于：多门店分 Sheet 出库单

```typescript
interface SheetMergeConfig {
  sheetNames?: string[];         // 指定 Sheet，不指定则遍历全部
  excludeSheets?: string[];      // 排除的 Sheet
  sheetNameAsField?: string;     // Sheet 名作为字段写入 (如 "门店")
  perSheetSteps: ParsingStep[];  // 每个 Sheet 内部的解析步骤
}
```

#### 5.3.7 其他辅助提取器

```typescript
// cell-split：单元格内文本拆分（用于周配送计划）
interface CellSplitConfig {
  splitBy: string;               // 分隔符
  subFields: SubField[];         // 子字段定义
}

// group-by：跨行聚合（用于湖南仓按配送单号分组）
interface GroupByConfig {
  groupField: string;            // 分组字段 (如 "配送单号")
  aggregateFields?: string[];    // 需要聚合的字段 (如多个物品行)
  sharedFields: string[];        // 共享字段 (收货人信息)
}
```

### 5.4 解析引擎执行流程

```
输入：文件 Buffer + ParsingRule
                              ↓
┌─────────────────┐    ┌──────────────┐
│  File Preprocessor │ →  │ Extractor Router │
│  (xlsx/pdf/docx)   │    │ (根据 step type   │
│  转成统一中间格式   │    │  路由到对应提取器) │
└─────────────────┘    └──────┬───────┘
                              ↓
              ┌───────────────┴───────────────┐
              ↓               ↓               ↓
        standard-table   card-split    text-regex
              ↓               ↓               ↓
              └───────────────┬───────────────┘
                              ↓
                    中间数据 (Record[])
                              ↓
                    按 step 顺序执行下一步
                              ↓
                    合并所有步骤的结果
                              ↓
                    对非结构化步骤：
                    调用 LLM 辅助提取
                              ↓
                    应用 fieldMapping
                              ↓
                    输出 Orders[]
```

### 5.5 统一中间格式

所有文件先转为统一格式：

```typescript
interface UnifiedWorkbook {
  sheets: UnifiedSheet[];
  metadata: {
    fileName: string;
    fileType: "xlsx" | "xls" | "docx" | "pdf";
    totalSheets: number;
  };
}

interface UnifiedSheet {
  name: string;
  // 二维单元格数组，保留原始行/列结构
  cells: CellValue[][];
  // 原始文本（用于 text-regex 提取）
  rawText?: string;
  // PDF 的段落结构
  paragraphs?: TextParagraph[];
}

interface CellValue {
  value: string | number | null;
  row: number;
  col: number;
  // 合并单元格信息
  mergeSpan?: { rowSpan: number; colSpan: number };
}
```

---

## 六、AI Service 设计

### 6.1 环境配置

```bash
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

### 6.2 AI 职能一：分析文件结构 → 生成推荐规则

**接口：** `POST /api/ai/analyze`

**输入：**
```typescript
interface AnalyzeRequest {
  fileContent: UnifiedWorkbook;  // 文件完整中间格式
  sampleRows: number;            // 采样行数 (默认 50)
}
```

**Prompt 策略：**

```
System: 你是物流出库单解析专家。分析文件结构，生成解析规则 JSON。

你需要：
1. 识别文件类型（标准表格 / 矩阵 / 卡片式 / 纯文本 / 混合）
2. 确定需要哪些提取步骤及顺序
3. 为每个步骤配置参数
4. 推断字段映射关系

可用的提取器：
- standard-table: 标准表格。参数：headerRow, dataStartRow, skipRows, columnMapping
- matrix-transpose: 矩阵转置。参数：rowHeaders, colHeaderRow, dataArea, cellSplitter
- card-split: 卡片拆分。参数：cardMarker, innerTablePosition, cardFields
- text-regex: 纯文本解析。参数：recordSeparator, fieldPatterns, itemListPattern
- tail-section: 尾部信息区。参数：afterRow, fieldPatterns, extractMode
- sheet-merge: 多Sheet合并。参数：perSheetSteps

输出 JSON 格式：
{
  "analysis": "文件结构分析说明...",
  "recommendedSteps": [...],
  "fieldMapping": {...},
  "confidence": {
    "overall": "high|medium|low",
    "details": "哪些字段确定、哪些是推测的说明"
  }
}

注意：
- 对于无法完全确定的映射，confidence 标记为 medium 或 low
- 在每个字段的 aiInferred=true, aiConfidence 标注推测置信度
```

**输出：** 完整的 `ParsingRule` JSON + 分析说明

### 6.3 AI 职能二：解析非结构化文本区域

**调用时机：** 仅当 step 配置了 `useLlm: true` 时

**输入：** 非结构化区域的文本 + 字段提取要求

**输出：** `Record<string, string>[]` 结构化数据

### 6.4 Token 优化策略

1. **分析阶段：** 只发文件前 50 行 + 最后 10 行（尾部信息）
2. **解析阶段：** 已由 DSL 引擎处理大部分数据，LLM 只处理少量尾部文本
3. **缓存：** 同类文件的分析结果缓存，避免重复调用
4. **多页 PDF：** 先发第 1 页分析结构，确认后再批量解析

---

## 七、页面设计

### 7.1 首页 `/`

- 仪表盘风格：三个卡片入口
  - **导入文件**：上传并解析出库单
  - **管理规则**：创建/编辑解析规则
  - **查看运单**：历史已导入运单列表
- 统计概览（可选）：今日导入数、总运单数

### 7.2 规则管理 `/rules`

- Ant Design Table 展示所有规则
- 操作列：编辑、复制、删除
- 顶部："新建规则"按钮
- 空状态：引导用户创建第一条规则

### 7.3 新建/编辑规则 `/rules/new`、`/rules/[id]/edit`

核心流程：

```
上传样例文件 → AI 分析 → 展示推荐规则 → 用户微调确认 →
预览测试（试解析） → 保存规则
```

**AI 分析阶段 UI：**
- 上传文件区域（同 `/import` 的上传组件）
- 上传后显示"分析中..."加载动画
- 分析完成后展示：
  - AI 分析说明文字
  - Steps 列表（每步类型、参数、状态）
  - 字段映射表（标注哪些是 AI 推测的，黄色高亮）
  - 置信度标签（high 绿色 / medium 黄色 / low 红色）

**用户微调区域：**
- Steps 编辑器：添加/删除/调整步骤顺序，编辑各步骤配置（表单化）
- 字段映射编辑器：下拉选择数据源字段 → 目标字段，支持 transform 函数
- 实时 JSON 预览（只读）

**预览测试：**
- 点击"试解析"按钮
- 调用解析引擎执行当前规则
- 右侧/下方展示解析结果表格

### 7.4 文件导入 `/import`

```
┌─────────────────────────────────────────────┐
│  导入出库单文件                               │
│                                              │
│  ┌───────────────────────────────┐           │
│  │   📁 拖拽文件到此处或点击上传  │           │
│  │   支持 .xlsx .xls .docx .pdf  │           │
│  └───────────────────────────────┘           │
│                                              │
│  选择解析规则：                               │
│  ┌───────────────────────────────┐           │
│  │  [选择规则下拉框 ▼]  新建规则  │           │
│  └───────────────────────────────┘           │
│                                              │
│  [开始解析]  (仅在选择规则后可用)              │
│                                              │
│  解析进度：████████░░░░ 60% (120/200 条)      │
└─────────────────────────────────────────────┘
```

### 7.5 数据预览 `/import/[id]/preview`

**核心组件：可编辑表格**

- Ant Design Table 实现
  - 表头固定 (`sticky`)
  - 横向滚动 (`scroll.x`)
  - 列可直接点击编辑（行内编辑模式）
- 分组展示：按外部编码聚类，每组显示为一个出库单卡片
- 每个出库单卡片：收货信息区（可编辑）+ SKU 明细表（可编辑）

**实时校验（全部错误一次性展示）：**

| 校验项 | 规则 | 表现 |
|--------|------|------|
| A/B组必填 | 门店/收件人信息至少填一组 | 收货信息区红色边框 |
| SKU编码必填 | 不能为空 | 单元格红色高亮 |
| SKU名称必填 | 不能为空 | 单元格红色高亮 |
| 发货数量 | 必须为正整数 | 单元格红色高亮 |
| 收件人电话 | 匹配手机号格式 | 单元格红色高亮 |
| 外部编码重复 | 同批次/跨批次 | 行黄色高亮 + Tooltip |

**操作：**
- 删除行：每行末尾删除按钮
- 新增行：底部"添加SKU"按钮、底部"添加出库单"按钮
- 导出 Excel：顶部导出按钮
- 提交下单：顶部提交按钮（有错误时 disabled）

**错误列表：** 表格上方/侧边展示所有校验错误汇总

### 7.6 提交下单

- 点击"提交下单" → 二次确认弹窗
- 提交进度：进度条展示（X/N 条）
- 结果汇总弹窗：成功 150 条，失败 3 条 + 失败原因
- 提交成功 → data 持久化到数据库，`status = submitted`

### 7.7 已导入运单列表 `/orders`

- Ant Design Table + 分页
- 搜索/筛选：
  - 外部编码（模糊搜索）
  - 收件人姓名（模糊搜索）
  - 提交时间范围
- 列：外部编码、收货门店、收件人、SKU数、提交时间
- 点击行展开详情

---

## 八、API Routes 详设

### 8.1 规则管理

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/rules` | 规则列表，支持 `?search=xxx` 搜索 |
| `POST` | `/api/rules` | 创建规则 |
| `GET` | `/api/rules/[id]` | 规则详情 |
| `PUT` | `/api/rules/[id]` | 更新规则 |
| `DELETE` | `/api/rules/[id]` | 删除规则 |
| `POST` | `/api/rules/[id]/copy` | 复制规则 |

### 8.2 AI 服务

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/ai/analyze` | 分析文件结构，返回推荐规则 |
| `POST` | `/api/ai/parse-text` | 解析非结构化文本区域 |

### 8.3 文件导入与解析

| 方法 | 路由 | 说明 |
|------|------|------|
| `POST` | `/api/import/upload` | 上传文件（multipart），返回 importId |
| `GET` | `/api/import/[id]/parse` | 执行解析（SSE 流式推送进度） |
| `GET` | `/api/import/[id]/data` | 获取解析后的数据 |
| `PUT` | `/api/import/[id]/data` | 保存用户编辑后的数据 |
| `POST` | `/api/import/[id]/validate` | 全量数据校验 |
| `POST` | `/api/import/[id]/submit` | 提交下单 |
| `GET` | `/api/import/[id]/export` | 导出 Excel |

### 8.4 运单管理

| 方法 | 路由 | 说明 |
|------|------|------|
| `GET` | `/api/orders` | 运单列表（`?page=&pageSize=&search=&startDate=&endDate=`） |
| `GET` | `/api/orders/[id]` | 运单详情（含 items） |

### 8.5 SSE 进度推送格式

```typescript
// Event stream
event: progress
data: {"current": 120, "total": 200, "percent": 60, "message": "正在解析第120行..."}

event: complete
data: {"total": 200, "success": 198, "failed": 2}

event: error
data: {"message": "文件格式无法识别", "code": "UNKNOWN_FORMAT"}
```

---

## 九、错误处理

### 9.1 文件上传

| 场景 | 处理 |
|------|------|
| 不支持的文件格式 | 前端校验扩展名 + MIME，拒绝上传并提示 |
| 文件为空 | 上传后检查文件大小 > 0 |
| 文件损坏 | 解析库报错时捕获，提示"文件已损坏" |
| 文件过大 | 限制 20MB，超出提示 |

### 9.2 解析过程

| 场景 | 处理 |
|------|------|
| 规则与文件不匹配 | 解析结果全空时提示"规则可能不适用" |
| LLM API 调用失败 | 降级：跳过 AI 辅助步骤，仅用 DSL 引擎 |
| LLM 返回格式异常 | 重试 1 次，仍失败则降级 |
| 部分行解析失败 | 跳过失败行，统计失败数 |
| 全部解析失败 | 展示原始文件内容 + 引导用户配置规则 |

### 9.3 数据库

- 连接超时：Neon 连接池自动重连
- 写入失败：事务回滚，返回错误提示

---

## 十、目录结构

```
ai-import/
├── .env.local                    # 环境变量 (LLM key, DB URL)
├── .env.example
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── drizzle.config.ts
├── drizzle/                      # Drizzle 迁移文件
├── src/
│   ├── app/
│   │   ├── layout.tsx            # 根布局 (Ant Design + Tailwind)
│   │   ├── page.tsx              # 首页
│   │   ├── globals.css           # 全局样式
│   │   ├── rules/
│   │   │   ├── page.tsx          # 规则管理列表
│   │   │   ├── new/
│   │   │   │   └── page.tsx      # 新建规则 (AI辅助)
│   │   │   └── [id]/
│   │   │       └── edit/
│   │   │           └── page.tsx  # 编辑规则
│   │   ├── import/
│   │   │   ├── page.tsx          # 文件导入
│   │   │   └── [id]/
│   │   │       └── preview/
│   │   │           └── page.tsx  # 数据预览
│   │   ├── orders/
│   │   │   ├── page.tsx          # 运单列表
│   │   │   └── [id]/
│   │   │       └── page.tsx      # 运单详情
│   │   └── api/
│   │       ├── rules/
│   │       │   ├── route.ts
│   │       │   └── [id]/
│   │       │       ├── route.ts
│   │       │       └── copy/
│   │       │           └── route.ts
│   │       ├── ai/
│   │       │   ├── analyze/
│   │       │   │   └── route.ts
│   │       │   └── parse-text/
│   │       │       └── route.ts
│   │       ├── import/
│   │       │   ├── upload/
│   │       │   │   └── route.ts
│   │       │   └── [id]/
│   │       │       ├── parse/
│   │       │       │   └── route.ts
│   │       │       ├── data/
│   │       │       │   └── route.ts
│   │       │       ├── validate/
│   │       │       │   └── route.ts
│   │       │       ├── submit/
│   │       │       │   └── route.ts
│   │       │       └── export/
│   │       │           └── route.ts
│   │       └── orders/
│   │           ├── route.ts
│   │           └── [id]/
│   │               └── route.ts
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx     # 主布局 (侧边栏 + 顶栏)
│   │   │   └── Header.tsx
│   │   ├── upload/
│   │   │   ├── FileUploader.tsx  # 拖拽上传组件
│   │   │   └── UploadProgress.tsx
│   │   ├── rules/
│   │   │   ├── RuleList.tsx
│   │   │   ├── RuleEditor.tsx    # 规则编辑器
│   │   │   ├── FieldMappingEditor.tsx
│   │   │   ├── StepsEditor.tsx
│   │   │   ├── RulePreview.tsx   # 规则预览测试
│   │   │   └── AiAnalysisPanel.tsx # AI分析结果展示
│   │   ├── preview/
│   │   │   ├── DataPreviewTable.tsx  # 可编辑数据表
│   │   │   ├── OrderCard.tsx         # 出库单卡片
│   │   │   ├── ValidationSummary.tsx # 校验错误汇总
│   │   │   └── SubmitDialog.tsx      # 提交确认弹窗
│   │   └── orders/
│   │       ├── OrderTable.tsx
│   │       └── OrderSearch.tsx
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts          # Drizzle 实例
│   │   │   ├── schema.ts         # Schema 定义
│   │   │   └── migrations/
│   │   ├── parser/
│   │   │   ├── engine.ts         # 解析引擎主入口
│   │   │   ├── types.ts          # 解析引擎类型定义
│   │   │   ├── preprocessor.ts   # 文件预处理器 (xlsx/pdf/docx → 统一格式)
│   │   │   ├── extractors/
│   │   │   │   ├── index.ts
│   │   │   │   ├── standard-table.ts
│   │   │   │   ├── matrix-transpose.ts
│   │   │   │   ├── card-split.ts
│   │   │   │   ├── text-regex.ts
│   │   │   │   ├── tail-section.ts
│   │   │   │   ├── sheet-merge.ts
│   │   │   │   ├── cell-split.ts
│   │   │   │   └── group-by.ts
│   │   │   └── field-mapper.ts   # 字段映射器
│   │   ├── ai/
│   │   │   ├── client.ts         # LLM 客户端（OpenAI-compatible）
│   │   │   ├── analyzer.ts       # 文件分析 Prompt
│   │   │   └── text-parser.ts    # 文本解析 Prompt
│   │   ├── validation/
│   │   │   └── validator.ts      # 数据校验器
│   │   └── utils/
│   │       ├── file.ts           # 文件工具函数
│   │       └── excel.ts          # Excel 导出工具
│   └── hooks/
│       ├── useRuleList.ts
│       ├── useFileImport.ts
│       ├── useDataPreview.ts
│       └── useOrderList.ts
```

---

## 十一、关键依赖

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "antd": "^5.20.0",
    "@ant-design/icons": "^5.4.0",
    "@ant-design/nextjs-registry": "^1.0.0",
    "drizzle-orm": "^0.33.0",
    "@neondatabase/serverless": "^0.9.0",
    "drizzle-kit": "^0.24.0",
    "xlsx": "^0.18.5",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1",
    "openai": "^4.55.0",
    "exceljs": "^4.4.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tailwindcss": "^3.4.0",
    "@types/node": "^22.0.0",
    "eslint": "^8.57.0"
  }
}
```

---

## 十二、实施优先级

### Phase 1：基础设施 + 核心引擎 (最优先)
1. 项目脚手架 (Next.js + Ant Design + Tailwind + 主色配置)
2. 数据库 Schema + Drizzle 迁移
3. 文件预处理器 (xlsx/docx/pdf → 统一格式)
4. 6 种提取器实现
5. 字段映射器
6. 解析引擎主控流程

### Phase 2：规则管理 + AI 集成
7. 规则 CRUD API + 页面
8. AI 文件分析服务
9. AI 辅助生成规则 UI（新建/编辑规则页面）

### Phase 3：导入与预览
10. 文件上传 + 拖拽
11. 解析执行 + SSE 进度
12. 数据预览表格（编辑、校验）
13. Excel 导出

### Phase 4：提交与历史
14. 提交下单流程
15. 运单列表（搜索、分页）
16. 首页仪表盘

---

## 十三、待确认事项

- [ ] 文件存储方案：Vercel Blob（需额外配置）还是仅内存临时处理？
- [ ] 是否需要用户登录认证？
- [ ] 大模型 API 是哪个具体服务？（千问、智谱、文心？）
- [ ] Demo 文件是否需要我生成模拟数据？

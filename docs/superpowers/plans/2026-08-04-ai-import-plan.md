# AI 智能文件解析导入系统 - 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Web 应用，通过 DSL 规则引擎 + LLM 智能辅助实现任意格式出库单文件的解析与批量下单。

**Architecture:** Next.js 14 App Router + TypeScript 全栈应用，前端使用 Ant Design 5 + Tailwind CSS，后端 API Routes 处理业务逻辑，Neon PostgreSQL + Drizzle ORM 持久化数据，LLM (OpenAI-compatible) 辅助文件分析和文本解析。

**Tech Stack:** Next.js 14 + TypeScript + Ant Design 5 + Tailwind CSS 3 + Neon PostgreSQL + Drizzle ORM + SheetJS + Mammoth + pdf-parse + OpenAI SDK

---

## 前置准备

- [ ] **Step 1: 初始化 Next.js 项目**

```bash
npx create-next-app@14 ai-import --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd ai-import
```

- [ ] **Step 2: 安装所有依赖**

```bash
npm install antd @ant-design/icons @ant-design/nextjs-registry drizzle-orm @neondatabase/serverless drizzle-kit openai xlsx mammoth pdf-parse exceljs uuid
npm install -D @types/node @types/pdf-parse
```

- [ ] **Step 3: 配置 Tailwind + Ant Design 主题**

Modify `tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0fc6c2",
        "primary-light": "#e6faf9",
        "primary-dark": "#0ba8a4",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 4: 提交初始化**

```bash
git add -A && git commit -m "chore: init Next.js project with dependencies"
```

---

## Chunk 1: 数据库 Schema + 基础设施

### Task 1.1: 环境变量配置

**Files:**
- Create: `.env.example`
- Create: `.env.local` (手动创建)

- [ ] **Step 1: 创建 `.env.example`**

```bash
# 大模型配置
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus

# Neon 数据库
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/ai_import?sslmode=require
```

- [ ] **Step 2: 设置 Neon 数据库连接**（用户手动操作）

访问 https://console.neon.tech/ 创建数据库，获取连接字符串填入 `.env.local`

- [ ] **Step 3: 提交**

```bash
git add .env.example && git commit -m "chore: add env example"
```

### Task 1.2: Drizzle ORM 配置 + Schema

**Files:**
- Create: `drizzle.config.ts`
- Create: `src/lib/db/index.ts`
- Create: `src/lib/db/schema.ts`

- [ ] **Step 1: 创建 `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 2: 创建 `src/lib/db/index.ts`**

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 3: 创建 `src/lib/db/schema.ts`**（完整 Schema 定义）

按照设计文档的 4 张表定义完整的 Drizzle Schema，包括 parsing_rules、file_imports、orders、order_items。

- [ ] **Step 4: 运行数据库迁移**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: add database schema and Drizzle config"
```

---

## Chunk 2: 解析规则引擎核心

### Task 2.1: 类型定义

**Files:**
- Create: `src/lib/parser/types.ts`

- [ ] **Step 1: 创建类型文件**

完整定义所有提取器类型、字段映射类型、统一中间格式类型、规则类型。按设计文档 §五 精确实现，包括：
- `ParsingRule`, `ParsingStep`, `StepType`
- `FieldMapping`, `FieldSource`
- `StandardTableConfig`, `MatrixTransposeConfig`, `CardSplitConfig`, `TextRegexConfig`, `TailSectionConfig`, `SheetMergeConfig`, `CellSplitConfig`, `GroupByConfig`
- `UnifiedWorkbook`, `UnifiedSheet`, `CellValue`
- `ParsedOrder`, `ParsedOrderItem`

- [ ] **Step 2: 提交**

```bash
git add src/lib/parser/types.ts && git commit -m "feat: add parser type definitions"
```

### Task 2.2: 文件预处理器

**Files:**
- Create: `src/lib/parser/preprocessor.ts`

- [ ] **Step 1: 实现 Excel 预处理（SheetJS）**

```typescript
import * as XLSX from "xlsx";

export async function preprocessExcel(buffer: ArrayBuffer): Promise<UnifiedWorkbook> {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheets: UnifiedSheet[] = [];
  
  workbook.SheetNames.forEach((name) => {
    const ws = workbook.Sheets[name];
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { header: 1, defval: null });
    const cells: CellValue[][] = jsonData.map((row: any[], rowIdx: number) =>
      (row as any[]).map((val, colIdx) => ({ value: val ?? null, row: rowIdx, col: colIdx }))
    );
    // 处理合并单元格
    const merges = ws["!merges"] || [];
    merges.forEach((merge: XLSX.Range) => {
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (cells[r]?.[c]) {
            cells[r][c].mergeSpan = {
              rowSpan: merge.e.r - merge.s.r + 1,
              colSpan: merge.e.c - merge.s.c + 1,
            };
          }
        }
      }
    });
    const rawText = jsonData.map((row: any[]) => row.join("\t")).join("\n");
    sheets.push({ name, cells, rawText });
  });
  
  return { sheets, metadata: { fileName: "", fileType: "xlsx", totalSheets: sheets.length } };
}
```

- [ ] **Step 2: 实现 Word 预处理（Mammoth）**

使用 mammoth 提取纯文本段落，生成 `paragraphs` 和 `rawText`。

- [ ] **Step 3: 实现 PDF 预处理（pdf-parse）**

使用 pdf-parse 提取文本，按页拆分 Sheet，生成 `paragraphs` 和 `rawText`。

- [ ] **Step 4: 实现统一入口函数**

```typescript
export async function preprocessFile(buffer: ArrayBuffer, fileType: string, fileName: string): Promise<UnifiedWorkbook> {
  switch (fileType) {
    case "xlsx": case "xls": return preprocessExcel(buffer);
    case "docx": return preprocessWord(buffer);
    case "pdf": return preprocessPdf(buffer);
    default: throw new Error(`Unsupported file type: ${fileType}`);
  }
}
```

- [ ] **Step 5: 提交**

```bash
git add src/lib/parser/preprocessor.ts && git commit -m "feat: add file preprocessor (xlsx/docx/pdf)"
```

### Task 2.3: 提取器实现（parallel batch）

**Files:**
- Create: `src/lib/parser/extractors/index.ts`
- Create: `src/lib/parser/extractors/standard-table.ts`
- Create: `src/lib/parser/extractors/matrix-transpose.ts`
- Create: `src/lib/parser/extractors/card-split.ts`
- Create: `src/lib/parser/extractors/text-regex.ts`
- Create: `src/lib/parser/extractors/tail-section.ts`
- Create: `src/lib/parser/extractors/sheet-merge.ts`
- Create: `src/lib/parser/extractors/cell-split.ts`
- Create: `src/lib/parser/extractors/group-by.ts`

所有提取器都实现统一接口：
```typescript
interface Extractor {
  type: StepType;
  extract(sheet: UnifiedSheet, config: StepConfig): Record<string, any>[];
}
```

- [ ] **Step 1: 实现 `standard-table` 提取器**

根据 `headerRow` 读取表头列名，从 `dataStartRow` 到 `dataEndRow` 逐行读取，跳过 `skipRows`，按 `columnMapping` 映射字段名。处理 `mergeCellStrategy: "fill-down"` 的合并单元格。

- [ ] **Step 2: 实现 `matrix-transpose` 提取器**

读取行头固定列，读取列头行获取转置列值。遍历数据区域，对于每个单元格 (row, col)，创建一个新行记录：行头字段 + 列头字段 + 单元格值。如果是复合单元格（配置了 cellSplitter），则进一步拆分为多行。

- [ ] **Step 3: 实现 `card-split` 提取器**

按 `cardMarker` 扫描所有行找到卡片起始位置。对每个卡片，按 `innerTableHeaderRowOffset` 定位子表格，按 `cardFields` 提取卡片级字段。

- [ ] **Step 4: 实现 `text-regex` 提取器**

按 `recordSeparator` 分割文本为多个记录块。对每个块，用 `fieldPatterns` 正则提取字段，用 `itemListPattern` 正则提取物品行（`matchAll`）。

- [ ] **Step 5: 实现 `tail-section` 提取器**

根据 `startMarker` 或 `afterRow` 定位尾部区域。horizontal 模式：在某几行中用列偏移提取字段；vertical 模式：在某几列中用行偏移提取；paragraph 模式：用正则从纯文本提取。

- [ ] **Step 6: 实现 `sheet-merge` 提取器**

遍历所有 Sheet（或指定 Sheet），对每个 Sheet 执行 `perSheetSteps`，将结果合并，可选地将 Sheet 名写入 `sheetNameAsField` 字段。

- [ ] **Step 7: 实现 `cell-split` 和 `group-by` 辅助提取器**

cell-split：按分隔符拆分单元格文本为多行子字段。
group-by：按 groupField 分组，同一组的 aggregateFields 合并为一个数组，sharedFields 取第一行的值。

- [ ] **Step 8: 实现提取器路由器 `index.ts`**

```typescript
const extractors: Record<StepType, Extractor> = {
  "standard-table": new StandardTableExtractor(),
  "matrix-transpose": new MatrixTransposeExtractor(),
  "card-split": new CardSplitExtractor(),
  "text-regex": new TextRegexExtractor(),
  "tail-section": new TailSectionExtractor(),
  "sheet-merge": new SheetMergeExtractor(),
  "cell-split": new CellSplitExtractor(),
  "group-by": new GroupByExtractor(),
};

export function executeStep(sheet: UnifiedSheet, step: ParsingStep): Record<string, any>[] {
  const extractor = extractors[step.type];
  if (!extractor) throw new Error(`Unknown step type: ${step.type}`);
  return extractor.extract(sheet, step.config);
}
```

- [ ] **Step 9: 提交**

```bash
git add src/lib/parser/extractors/ && git commit -m "feat: implement all 8 extractors"
```

### Task 2.4: 字段映射器 + 解析引擎主控

**Files:**
- Create: `src/lib/parser/field-mapper.ts`
- Create: `src/lib/parser/engine.ts`

- [ ] **Step 1: 实现字段映射器**

```typescript
export function applyFieldMapping(
  intermediateData: Record<string, any>[],
  fieldMapping: FieldMapping
): ParsedOrder[] {
  // 将中间数据按 fieldMapping 映射为目标 ParsedOrder 结构
  // 如果配置了 transform，执行对应的转换函数
  // 返回 ParsedOrder[]
}
```

- [ ] **Step 2: 实现解析引擎主控**

```typescript
export async function parseFile(
  workbook: UnifiedWorkbook,
  rule: ParsingRule,
  onProgress?: (current: number, total: number) => void
): Promise<ParsedOrder[]> {
  let allIntermediate: Record<string, any>[] = [];
  
  for (const step of rule.steps) {
    if (!step.enabled) continue;
    
    // sheet-merge 需要特殊处理：遍历所有 sheet
    if (step.type === "sheet-merge") {
      // 对每个 sheet 执行 perSheetSteps，合并结果
      const results = executeStep(workbook.sheets, step);
      allIntermediate = [...allIntermediate, ...results];
    } else if (step.useLlm) {
      // 调用 AI 辅助解析
      const aiResult = await callAiForStep(workbook, step);
      allIntermediate = [...allIntermediate, ...aiResult];
    } else {
      // 在第一个 sheet 上执行
      const results = executeStep(workbook.sheets[0], step);
      allIntermediate = [...allIntermediate, ...results];
    }
    
    onProgress?.(allIntermediate.length, 0);
  }
  
  return applyFieldMapping(allIntermediate, rule.fieldMapping);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/lib/parser/ && git commit -m "feat: add field mapper and parsing engine"
```

---

## Chunk 3: AI 服务

### Task 3.1: LLM 客户端

**Files:**
- Create: `src/lib/ai/client.ts`

- [ ] **Step 1: 实现 OpenAI-compatible 客户端**

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: process.env.LLM_BASE_URL,
});

const MODEL = process.env.LLM_MODEL || "qwen-plus";

export async function chat(messages: { role: string; content: string }[]): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: messages as any,
    temperature: 0.1,
    max_tokens: 4096,
  });
  return response.choices[0]?.message?.content || "";
}
```

- [ ] **Step 2: 提交**

```bash
git add src/lib/ai/client.ts && git commit -m "feat: add LLM client"
```

### Task 3.2: AI 文件分析器

**Files:**
- Create: `src/lib/ai/analyzer.ts`
- Create: `src/lib/ai/text-parser.ts`

- [ ] **Step 1: 实现文件结构分析 Prompt + 调用函数**

设计详细的 System Prompt，描述 6 种提取器的用途和参数格式。将文件前 50 行的内容作为 User Message 发送。解析返回的 JSON 为 ParsingRule 格式，标注 aiInferred 和 confidence。

- [ ] **Step 2: 实现文本解析函数**

针对 tail-section 和 text-regex 场景，将非结构化文本发送给 LLM，附带字段提取要求，返回结构化记录数组。

- [ ] **Step 3: 提交**

```bash
git add src/lib/ai/ && git commit -m "feat: add AI analyzer and text parser"
```

---

## Chunk 4: 规则管理 API + 页面

### Task 4.1: 规则 CRUD API

**Files:**
- Create: `src/app/api/rules/route.ts`
- Create: `src/app/api/rules/[id]/route.ts`
- Create: `src/app/api/rules/[id]/copy/route.ts`

- [ ] **Step 1: 实现 `GET/POST /api/rules`**

GET：查询所有规则，支持 `?search=` 参数模糊匹配 name
POST：验证 body 为合法 ParsingRule JSON，写入数据库

- [ ] **Step 2: 实现 `GET/PUT/DELETE /api/rules/[id]`**

GET：单条规则详情
PUT：更新规则（steps + fieldMapping）
DELETE：删除规则（级联不删除关联的 imports）

- [ ] **Step 3: 实现 `POST /api/rules/[id]/copy`**

读取原规则，去掉 id，修改 name 添加"副本"后缀，写入新记录

- [ ] **Step 4: 提交**

```bash
git add src/app/api/rules/ && git commit -m "feat: add rules CRUD API"
```

### Task 4.2: AI 分析 API

**Files:**
- Create: `src/app/api/ai/analyze/route.ts`

- [ ] **Step 1: 实现 `POST /api/ai/analyze`**

接收上传的文件 Buffer，调用预处理器转为统一格式，采样前 50 行。调用 AI 分析器获取推荐规则 JSON。验证 JSON 结构合法性后返回给前端。

- [ ] **Step 2: 错误处理**

LLM 返回格式异常时重试 1 次，仍失败返回 500 + error 说明。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/ai/ && git commit -m "feat: add AI analyze API"
```

### Task 4.3: 全局布局 + 主题配置

**Files:**
- Create: `src/app/layout.tsx` (修改)
- Create: `src/app/globals.css` (修改)
- Create: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 配置 Ant Design Registry + 主题**

修改 `src/app/layout.tsx`：
```tsx
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

const theme = {
  token: {
    colorPrimary: "#0fc6c2",
    borderRadius: 8,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <ConfigProvider theme={theme} locale={zhCN}>
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: 更新 globals.css** 添加基础样式

- [ ] **Step 3: 创建 AppLayout 组件**（侧边栏导航）

包含 Logo、菜单项（仪表盘、规则管理、导入文件、运单列表），使用 Ant Design Layout 组件。

- [ ] **Step 4: 提交**

```bash
git add src/app/layout.tsx src/app/globals.css src/components/layout/ && git commit -m "feat: add global layout with Ant Design theme"
```

### Task 4.4: 规则管理页面

**Files:**
- Create: `src/app/rules/page.tsx`
- Create: `src/components/rules/RuleList.tsx`

- [ ] **Step 1: 实现规则列表页 `/rules`**

- Ant Design Table：列 = 名称、描述、来源（手动/AI）、使用次数、创建时间、操作
- 操作列：编辑、复制、删除
- 顶部：搜索框 + "新建规则"按钮（跳转 `/rules/new`）
- 使用 SWR 或 fetch 获取数据，点击进入编辑页

- [ ] **Step 2: 提交**

```bash
git add src/app/rules/ src/components/rules/ && git commit -m "feat: add rules management page"
```

### Task 4.5: 新建/编辑规则页面（含 AI 辅助）

**Files:**
- Create: `src/app/rules/new/page.tsx`
- Create: `src/app/rules/[id]/edit/page.tsx`
- Create: `src/components/rules/AiAnalysisPanel.tsx`
- Create: `src/components/rules/StepsEditor.tsx`
- Create: `src/components/rules/FieldMappingEditor.tsx`
- Create: `src/components/rules/RulePreview.tsx`
- Create: `src/components/upload/FileUploader.tsx`

- [ ] **Step 1: 实现文件上传组件 `FileUploader`**

拖拽 + 点击上传，支持 .xlsx/.xls/.docx/.pdf，文件大小限制 20MB。上传成功后返回文件 File 对象用于后续 AI 分析。

- [ ] **Step 2: 实现新建规则页面 `/rules/new`**

三步流程：
1. 上传样例文件 → 触发 AI 分析
2. 展示 AI 推荐规则（AiAnalysisPanel：分析说明 + Steps 列表 + 字段映射，黄色高亮 AI 推测项）
3. 用户微调（StepsEditor：添加/删除/编辑步骤表单 + FieldMappingEditor：下拉映射）
4. 预览测试（RulePreview：调用解析引擎试解析，展示结果表格）
5. 保存（调用 POST /api/rules）

- [ ] **Step 3: 实现编辑规则页面 `/rules/[id]/edit`**

与新建类似，但初始数据从 GET /api/rules/[id] 加载，保存时调用 PUT。

- [ ] **Step 4: 实现 StepsEditor 组件**

每种 step type 对应不同的配置表单：
- standard-table: 行号输入、列映射
- matrix-transpose: 行列区域定义、分隔符
- card-split: 卡片标记、偏移量
- 等等

- [ ] **Step 5: 实现 FieldMappingEditor 组件**

两列布局：左侧为所有 step 输出的字段路径（树形），右侧为目标字段下拉。AI 推测的字段用黄色标签标注。

- [ ] **Step 6: 实现 RulePreview 组件**

点击"试解析"按钮，使用当前规则对已上传文件执行解析，展示结果表格。结果不对则返回修改规则。

- [ ] **Step 7: 提交**

```bash
git add src/app/rules/ src/components/rules/ src/components/upload/ && git commit -m "feat: add rule editor with AI assistance"
```

---

## Chunk 5: 文件导入与解析

### Task 5.1: 上传 API

**Files:**
- Create: `src/app/api/import/upload/route.ts`

- [ ] **Step 1: 实现 `POST /api/import/upload`**

使用 Next.js `req.formData()` 接收文件。校验类型和大小。保存 Buffer 到临时变量或 Vercel Blob。在 file_imports 表创建记录（status: uploading），返回 importId。

- [ ] **Step 2: 提交**

```bash
git add src/app/api/import/upload/ && git commit -m "feat: add file upload API"
```

### Task 5.2: 解析 API（SSE 进度）

**Files:**
- Create: `src/app/api/import/[id]/parse/route.ts`

- [ ] **Step 1: 实现 `GET /api/import/[id]/parse`**

- 从数据库读取 file_imports 记录和关联的 parsing_rules
- 读取文件 Buffer
- 调用 preprocessor 转为 UnifiedWorkbook
- 调用 parseFile 引擎执行解析
- 通过 ReadableStream + SSE 推送进度事件
- 解析完成后将结果存入 file_imports.raw_content (jsonb)
- 返回 complete 事件

- [ ] **Step 2: 提交**

```bash
git add src/app/api/import/ && git commit -m "feat: add parse API with SSE progress"
```

### Task 5.3: 导入页面

**Files:**
- Create: `src/app/import/page.tsx`
- Create: `src/components/upload/UploadProgress.tsx`

- [ ] **Step 1: 实现导入页面 `/import`**

```
布局：
- 文件上传区域（FileUploader）
- 规则选择区域：Ant Design Select 下拉（从 GET /api/rules 加载）+ "新建规则"按钮
- "开始解析"按钮（选择规则后才可点击）
- 进度条（UploadProgress：百分比 + 当前/总数）
```

- [ ] **Step 2: 上传流程**

1. 用户选择文件 → 调用 POST /api/import/upload → 获取 importId
2. 用户选择或新建规则 → 规则 ID 关联到 import
3. 点击"开始解析" → 调用 GET /api/import/[id]/parse（SSE 流）
4. 监听 EventSource 事件更新进度条
5. 解析完成 → 跳转到 `/import/[id]/preview`

- [ ] **Step 3: 提交**

```bash
git add src/app/import/ src/components/upload/UploadProgress.tsx && git commit -m "feat: add file import page with progress"
```

- [ ] **Step 4: 错误处理**

解析失败时展示错误信息，保留 raw_content 供用户查看，提供"配置新规则"链接。

---

## Chunk 6: 数据预览与编辑

### Task 6.1: Data API

**Files:**
- Create: `src/app/api/import/[id]/data/route.ts`

- [ ] **Step 1: 实现 `GET /api/import/[id]/data`**

从 file_imports.raw_content 读取解析结果，转换格式返回给前端。

- [ ] **Step 2: 实现 `PUT /api/import/[id]/data`**

接收前端编辑后的完整数据，更新 raw_content。同时更新 orders 和 order_items 表（draft 状态）。

- [ ] **Step 3: 提交**

```bash
git add src/app/api/import/[id]/data/ && git commit -m "feat: add data read/write API"
```

### Task 6.2: 数据校验引擎

**Files:**
- Create: `src/lib/validation/validator.ts`
- Create: `src/app/api/import/[id]/validate/route.ts`

- [ ] **Step 1: 实现校验函数**

```typescript
interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  orderId?: string;
}

export function validateOrders(orders: ParsedOrder[]): ValidationError[] {
  const errors: ValidationError[] = [];
  
  orders.forEach((order, idx) => {
    // A/B组校验：门店 或 (姓名+电话+地址) 至少一组
    const hasGroupA = !!order.storeName;
    const hasGroupB = !!(order.receiverName && order.receiverPhone && order.receiverAddress);
    if (!hasGroupA && !hasGroupB) {
      errors.push({ rowIndex: idx, field: "storeName", message: "A组（门店）和B组（收件人）至少填一组" });
    }
    // 电话格式
    if (order.receiverPhone && !/^1[3-9]\d{9}$/.test(order.receiverPhone)) {
      errors.push({ rowIndex: idx, field: "receiverPhone", message: "收件人电话格式错误" });
    }
    // SKU必填校验
    order.items.forEach((item, itemIdx) => {
      if (!item.skuCode) errors.push({ rowIndex: idx, field: `items[${itemIdx}].skuCode`, message: "SKU编码不能为空" });
      if (!item.skuName) errors.push({ rowIndex: idx, field: `items[${itemIdx}].skuName`, message: "SKU名称不能为空" });
      if (!item.quantity || item.quantity <= 0) errors.push({ rowIndex: idx, field: `items[${itemIdx}].quantity`, message: "发货数量必须为正数" });
    });
    // 外部编码重复检测
    if (order.externalCode) {
      const dupCount = orders.filter((o, i) => i !== idx && o.externalCode === order.externalCode).length;
      if (dupCount > 0) {
        errors.push({ rowIndex: idx, field: "externalCode", message: `外部编码"${order.externalCode}"重复` });
      }
    }
  });
  
  return errors;
}
```

- [ ] **Step 2: 实现 `POST /api/import/[id]/validate`**

接收数据，调用 validateOrders，返回所有错误列表。

- [ ] **Step 3: 提交**

```bash
git add src/lib/validation/ src/app/api/import/[id]/validate/ && git commit -m "feat: add validation engine and API"
```

### Task 6.3: 数据预览页面

**Files:**
- Create: `src/app/import/[id]/preview/page.tsx`
- Create: `src/components/preview/DataPreviewTable.tsx`
- Create: `src/components/preview/OrderCard.tsx`
- Create: `src/components/preview/ValidationSummary.tsx`

- [ ] **Step 1: 实现 OrderCard 组件**（出库单卡片）

每个出库单显示为一张卡片：
- 头部：外部编码、收货门店 / 收货人信息（可编辑行内）
- 身体：SKU 明细表（Ant Table，可编辑单元格）
- 底部：备注（可编辑）

使用 Ant Design Card + Table（editable row/cell）

- [ ] **Step 2: 实现 ValidationSummary 组件**

表格上方展示所有校验错误的汇总列表（错误数、具体错误行号和原因）。使用 Ant Design Alert 组件。

- [ ] **Step 3: 实现 DataPreviewTable 主组件**

```
- 顶部工具栏：导出 Excel / 提交下单 / 添加出库单 按钮
- ValidationSummary（有错误时展示）
- 出库单卡片列表（每个 order 一个 OrderCard）
- 底部：添加 SKU 行按钮
```

- [ ] **Step 4: 实现执行校验逻辑**

页面加载时先校验，也可以在每次编辑后实时校验。有错误的行红色边框高亮。提交下单按钮 disabled。

- [ ] **Step 5: 提交**

```bash
git add src/app/import/[id]/preview/ src/components/preview/ && git commit -m "feat: add data preview page with editable table"
```

### Task 6.4: 导出 Excel

**Files:**
- Create: `src/app/api/import/[id]/export/route.ts`

- [ ] **Step 1: 实现导出 API `GET /api/import/[id]/export`**

使用 ExcelJS 生成 Excel 文件：
- 按出库单拆分 Sheet 或在一个 Sheet 中分组
- 表头：外部编码、收货门店、收件人、电话、地址、SKU编码、SKU名称、数量、规格、备注
- 设置列宽和样式
- 返回 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

- [ ] **Step 2: 提交**

```bash
git add src/app/api/import/[id]/export/ && git commit -m "feat: add Excel export API"
```

---

## Chunk 7: 提交下单 + 运单列表 + 首页

### Task 7.1: 提交下单 API

**Files:**
- Create: `src/app/api/import/[id]/submit/route.ts`

- [ ] **Step 1: 实现 `POST /api/import/[id]/submit`**

- 接收最终数据
- 先校验，有错误则拒绝提交
- 使用事务：逐条写入 orders + order_items 表，status = submitted
- 使用 SSE 推送提交进度
- 返回汇总：{ success: N, failed: N, errors: [...] }

- [ ] **Step 2: 提交**

```bash
git add src/app/api/import/[id]/submit/ && git commit -m "feat: add submit order API"
```

### Task 7.2: 提交确认弹窗

**Files:**
- Create: `src/components/preview/SubmitDialog.tsx`

- [ ] **Step 1: 实现提交弹窗**

点击"提交下单" → Modal 二次确认（"确认提交 X 条出库单？"）→ 调用 POST /api/import/[id]/submit → SSE 进度 → 结果汇总展示 → 关闭弹窗跳转 `/orders`

- [ ] **Step 2: 提交**

```bash
git add src/components/preview/SubmitDialog.tsx && git commit -m "feat: add submit confirmation dialog"
```

### Task 7.3: 运单列表 API + 页面

**Files:**
- Create: `src/app/api/orders/route.ts`
- Create: `src/app/api/orders/[id]/route.ts`
- Create: `src/app/orders/page.tsx`
- Create: `src/components/orders/OrderTable.tsx`
- Create: `src/components/orders/OrderSearch.tsx`

- [ ] **Step 1: 实现运单列表 API `GET /api/orders`**

支持查询参数：`page`, `pageSize`, `search`（外部编码/收件人模糊搜索），`startDate`, `endDate`。返回分页结果（总条数 + 数据）。

- [ ] **Step 2: 实现运单详情 API `GET /api/orders/[id]`**

返回单条 order + 关联的 order_items。

- [ ] **Step 3: 实现运单列表页 `/orders`**

- 搜索栏：外部编码、收件人姓名（Input.Search）、提交时间范围（DatePicker.RangePicker）
- Table：列 = 外部编码、收货门店、收件人、联系电话、SKU数、提交时间、操作
- 操作：查看详情（Modal 展示完整信息）
- 分页器

- [ ] **Step 4: 提交**

```bash
git add src/app/api/orders/ src/app/orders/ src/components/orders/ && git commit -m "feat: add orders list page and API"
```

### Task 7.4: 首页仪表盘

**Files:**
- Create: `src/app/page.tsx`

- [ ] **Step 1: 实现首页**

三个卡片快速入口（使用 Ant Design Card + Row/Col 布局）：
- 导入文件卡片（跳转 `/import`）
- 管理规则卡片（跳转 `/rules`）
- 查看运单卡片（跳转 `/orders`）

下方可选：今日统计（今日导入数、今日提交数、总运单数）- 可选实现

- [ ] **Step 2: 提交**

```bash
git add src/app/page.tsx && git commit -m "feat: add dashboard home page"
```

---

## Chunk 8: 集成测试与收尾

### Task 8.1: 整体功能联调

- [ ] **Step 1: 启动本地开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 验证全流程**

1. 新建规则 → AI 分析 → 保存规则
2. 导入文件 → 选择规则 → 解析
3. 预览数据 → 编辑 → 校验
4. 导出 Excel → 提交下单
5. 查看运单列表 → 搜索 → 分页

- [ ] **Step 3: 修复发现的问题**

---

### Task 8.2: Vercel 部署

- [ ] **Step 1: 配置 Vercel 项目**

```bash
npx vercel --prod
```

- [ ] **Step 2: 配置环境变量**

在 Vercel Dashboard 设置 LLM_API_KEY、LLM_BASE_URL、LLM_MODEL、DATABASE_URL

- [ ] **Step 3: 验证线上可访问**

确认 URL 可访问，测试核心流程。

---

## 附录：组件依赖关系

```
AppLayout
├── / (DashboardPage)
├── /rules (RulesPage)
│   └── RuleList
├── /rules/new (NewRulePage)
│   ├── FileUploader
│   ├── AiAnalysisPanel
│   ├── StepsEditor
│   ├── FieldMappingEditor
│   └── RulePreview
├── /rules/[id]/edit (EditRulePage)
│   └── (同上)
├── /import (ImportPage)
│   ├── FileUploader
│   ├── UploadProgress
│   └── RuleSelector (Select)
├── /import/[id]/preview (DataPreviewPage)
│   ├── ValidationSummary
│   ├── OrderCard[]
│   │   └── EditableTable (Ant Table)
│   └── SubmitDialog
└── /orders (OrdersPage)
    ├── OrderSearch
    └── OrderTable
```

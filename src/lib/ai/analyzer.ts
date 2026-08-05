import { chatWithRetry } from "./client";
import type { ParsingStep, FieldMapping } from "../parser/types";

const SYSTEM_PROMPT = `你是一个物流出库单解析专家。你的任务是分析上传的出库单文件内容，识别其结构类型，并生成一套解析规则 JSON。

你需要：
1. 识别文件类型（标准表格 / 矩阵转置 / 卡片式 / 纯文本 / 混合）
2. 确定需要哪些提取步骤及执行顺序
3. 为每个步骤配置准确的参数
4. 推断字段映射关系

## 可用的提取器类型

### 1. standard-table (标准表格)
适用于标准行列结构的表格数据。
参数：
- sheetIndex?: number (Sheet序号，0-based，默认0)
- headerRow: number (表头行号，0-based)
- dataStartRow: number (数据起始行号)
- dataEndRow?: number (数据结束行号，不含结尾)
- skipRows?: number[] (跳过的行号，如合计行)
- columnMapping?: Record<string, string> (原始列名→目标字段名 的映射，key=数据源中出现的列名，value=输出记录中的字段名)
- ignoreColumns?: string[] (忽略的列名)
- mergeCellStrategy?: "fill-down" | "skip" (合并单元格策略)

### 2. matrix-transpose (矩阵转置)
适用于行头和列头交叉的矩阵格式，需要将列头转置为行数据。
参数：
- rowHeaderStartRow: number
- rowHeaderStartCol: number
- rowHeaderEndCol: number
- rowHeaderNames?: string[] (行头字段名列表)
- colHeaderRow: number (列头所在行号)
- colHeaderStartCol: number
- colHeaderName: string (转置后列头的字段名，如"门店"、"日期")
- dataStartRow: number
- dataEndRow?: number
- dataStartCol: number
- cellSplitter?: string (单元格内文本分隔符)
- cellValuePattern?: string (单元格值正则，如 "(\\S+)x(\\d+)")
- cellFieldNames?: string[] (拆分后字段名)

### 3. card-split (卡片拆分)
适用于单个卡片纵向堆叠的非标准格式。
参数：
- cardMarker: string (卡片起始标志文本)
- cardMarkerPattern?: string
- innerTableHeaderRowOffset: number
- innerTableDataStartOffset: number
- innerTableEndMarker?: string
- cardFields: { name: string; rowOffset: number; prefix?: string; pattern?: string }[]

### 4. text-regex (纯文本正则解析)
适用于无表格结构的纯文本文件(docx/pdf)。
参数：
- recordSeparator: string (记录间分隔符)
- fieldPatterns: { name: string; pattern: string; group?: number }[]
- itemListPattern: string (物品行正则)
- itemFields: string[] (物品字段名列表)

### 5. tail-section (尾部信息区)
用于提取数据表格之外的信息(如收货人信息在文件底部)。
参数：
- startMarker?: string
- afterRow?: number
- extractMode: "horizontal" | "vertical" | "paragraph"
- fieldPatterns: { name: string; prefix?: string; regex?: string; rowOffset?: number; colOffset?: number }[]

### 6. sheet-merge (多Sheet合并)
用于多Sheet的Excel文件。
参数：
- sheetNames?: string[]
- excludeSheets?: string[]
- sheetNameAsField?: string

## 字段映射需要映射以下目标字段：
- externalCode: 外部编码(如配送单号)
- storeName: 收货门店 (A组)
- receiverName: 收件人姓名 (B组)
- receiverPhone: 收件人电话
- receiverAddress: 收件人地址
- skuCode: SKU编码 (必填)
- skuName: SKU名称 (必填)
- quantity: 发货数量 (必填)
- specification: 规格型号
- remark: 备注

## 输出格式

请严格按以下 JSON 格式输出（不要包含代码块标记）：

{
  "analysis": "文件结构分析说明",
  "steps": [
    {
      "id": "step-1",
      "type": "提取器类型",
      "label": "步骤中文描述",
      "enabled": true,
      "config": { ... }
    }
  ],
  "fieldMapping": {
    "externalCode": { "stepId": "step-1", "fieldPath": "externalCode", "aiInferred": false, "aiConfidence": "high" },
    "storeName": { "stepId": "step-2", "fieldPath": "storeName", "aiInferred": false, "aiConfidence": "high" },
    "skuCode": { "stepId": "step-1", "fieldPath": "skuCode", "aiInferred": false, "aiConfidence": "high" },
    "skuName": { "stepId": "step-1", "fieldPath": "skuName", "aiInferred": false, "aiConfidence": "high" },
    "quantity": { "stepId": "step-1", "fieldPath": "quantity", "aiInferred": false, "aiConfidence": "high" }
  },
  "confidence": {
    "overall": "high|medium|low",
    "details": "哪些字段确定、哪些是推测的说明"
  }
}

## 重要规则
- 所有行号从 0 开始计数
- 如果文件名是 xlsx/xls/docx/pdf，文件内容可能是原始文本而不是表格
- 对于不确切的映射，confidence 标记为 "medium" 或 "low"，aiInferred 设为 true
- 必须把所有可能的字段映射都标注出来
- 列名映射时使用数据源中实际出现的列名（区分大小写），不要翻译或猜测
- fieldPath 应填写步骤输出记录中的实际 key：若步骤有 columnMapping，使用目标字段名（如 "externalCode"）；若无 columnMapping，使用原始列名`;

export async function analyzeFileStructure(
  fileContent: string,
  metadata: { fileName: string; fileType: string; totalSheets: number }
): Promise<{
  analysis: string;
  steps: ParsingStep[];
  fieldMapping: FieldMapping;
  confidence: { overall: string; details: string };
}> {
  const userMessage = `请分析以下出库单文件，生成解析规则。

文件名: ${metadata.fileName}
文件类型: ${metadata.fileType}
Sheet 数量: ${metadata.totalSheets}

文件内容（前50行采样）:
\`\`\`
${fileContent.slice(0, 8000)}
\`\`\`

请严格按照 JSON 格式返回解析规则。`;

  const response = await chatWithRetry([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ]);

  // 清理可能的 markdown 代码块标记
  let jsonStr = response.trim();
  jsonStr = jsonStr.replace(/^```json\s*/i, "").replace(/^```\s*/i, "");
  jsonStr = jsonStr.replace(/\s*```$/, "");

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error("AI 返回的规则格式无效，请重试");
  }
}

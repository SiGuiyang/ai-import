# AI 智能生成解析规则 — 使用说明

## 概述

传统的手动配置解析规则需要逐一设置提取步骤类型、行列参数和字段映射，对非技术人员门槛极高。本系统集成大语言模型（LLM），只需**上传一份样例文件**，AI 即可自动识别文件结构并生成完整的解析规则，用户审核确认后即可直接投入使用。

---

## 工作流程

```
上传样例文件 → AI 分析结构 → 生成规则草案 → 人工审核确认 → 保存规则
```

### 1. 上传样例文件

进入「解析规则管理」页面 → 点击 **「新建规则」** 按钮，进入三步式创建流程。

**步骤 1 — 上传文件**：
- 拖拽或点击上传一份样例出库单文件
- 支持格式：`.xlsx`、`.xls`、`.docx`、`.pdf`
- 文件大小限制 ≤ 20 MB
- 建议上传**典型格式的单份样例**，而非全量数据

上传后点击 **「AI 分析文件结构」** 按钮触发分析。

### 2. AI 分析

后端处理流程：

1. **预处理文件** — 调用文件解析器（Excel / Word / PDF），提取所有 Sheet 的原始文本和单元格矩阵
2. **采样文本** — 截取每个 Sheet 的前 6,000 字符（总计 ≤ 8,000 字符）传给 LLM
3. **调用 LLM** — 将采样文本 + 文件名 + 文件类型发送给大模型，请求生成规则 JSON
4. **解析响应** — 清理 markdown 代码块标记，反序列化为结构化规则

大模型收到的 System Prompt 包含：
- 7 种提取器类型（standard-table、matrix-transpose、card-split、text-regex、tail-section、sheet-merge、cell-split、group-by）的完整参数说明
- 10 个目标映射字段定义
- 严格 JSON 输出格式要求
- 行号 0-based 约定、置信度标记规则

### 3. AI 生成结果

分析完成后进入**步骤 2 — 确认保存**，页面会展示：

| 区域 | 内容 |
|------|------|
| **AI 分析结果** | 置信度标签（高/中/低）、文件结构分析描述、字段推测详情 |
| **规则基本信息** | 自动填充的规则名称（`文件名 + 解析规则`），可修改 |
| **提取步骤配置** | 折叠面板展示每步的类型标签、参数值（表头行号、列名映射、分隔符等） |
| **字段映射配置** | 10 个目标字段与步骤输出的对应关系，AI 推测的字段会用橙色 `AI 推测` 标签标记 |

### 4. 人工审核与修改

用户可以：
- 修改规则名称和描述
- 调整步骤参数（表头行号、数据起始行、列名映射 JSON 等）
- 修改字段映射（选择步骤 → 填写字段路径）
- 参数格式错误的 AI 输出可直接修正

> 不同步骤类型的参数编辑 UI 不同：`standard-table` 提供表头行/起始行/列名映射输入框，`matrix-transpose` 提供列头行/字段名/数据行列输入框，`card-split` 提供卡片标记文本输入框，`text-regex` 提供记录分隔符输入框。其余类型显示 JSON 全量编辑区。

### 5. 保存

确认无误后点击 **「保存规则」**，规则以 `createdByLlm = true` 写入数据库，规则列表中会显示 `AI 生成` 标签。

若 AI 调用失败，页面会显示 Warning 提示，用户仍可**手动配置**步骤和映射后保存（此时 `createdByLlm = false`）。

---

## LLM 配置

AI 功能依赖环境变量中的 LLM 配置，在 `.env` 中设置：

```bash
# 模型名称（默认 qwen-plus）
LLM_MODEL="qwen-plus"

# API Key
LLM_API_KEY="sk-2851f205e45143609a31833325817a135b6f11111111"

# API 端点（默认 OpenAI 兼容接口）
LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
```

系统使用 OpenAI 兼容 SDK（`openai` npm 包），支持任何兼容 OpenAI 接口的服务：
- **通义千问**：`LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"`，`LLM_MODEL="qwen-plus"`

调用参数：
- `temperature = 0.1` — 低温度保证输出稳定
- `max_tokens = 4096` — 足够容纳完整规则 JSON
- 失败自动重试 1 次

---

## 支持的 8 种提取器类型

| 类型 | 适用场景 | 关键参数 |
|------|----------|----------|
| `standard-table` | 标准行列表格 | headerRow, dataStartRow, columnMapping |
| `matrix-transpose` | 行头 × 列头交叉矩阵 | colHeaderRow, colHeaderName, dataStartRow, dataStartCol |
| `card-split` | 纵向卡片堆叠 | cardMarker, cardFields |
| `text-regex` | 纯文本 / Word / PDF | recordSeparator, fieldPatterns, itemListPattern |
| `tail-section` | 表格外的尾部信息区 | startMarker, extractMode, fieldPatterns |
| `sheet-merge` | 多 Sheet Excel | sheetNames, excludeSheets |
| `cell-split` | 单元格内拆分 | splitBy, subFields |
| `group-by` | 分组聚合 | groupField, sharedFields |

---

## 字段映射

系统需要映射 10 个目标字段到提取步骤的输出列：

| 字段 | 名称 | 必填 |
|------|------|:----:|
| `externalCode` | 外部编码（配送单号） | |
| `storeName` | 收货门店 | |
| `receiverName` | 收件人姓名 | |
| `receiverPhone` | 收件人电话 | |
| `receiverAddress` | 收件人地址 | |
| `skuCode` | SKU 编码 | ✓ |
| `skuName` | SKU 名称 | ✓ |
| `quantity` | 发货数量 | ✓ |
| `specification` | 规格型号 | |
| `remark` | 备注 | |

---

## 相关接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `POST /api/ai/analyze` | POST | 上传文件 → AI 分析文件结构 |
| `GET /api/rules` | GET | 获取规则列表（`?search=关键词` 搜索） |
| `POST /api/rules` | POST | 创建规则（`name`, `steps`, `fieldMapping`, `createdByLlm`） |
| `GET /api/rules/[id]` | GET | 获取单条规则详情 |
| `PUT /api/rules/[id]` | PUT | 修改规则 |
| `DELETE /api/rules/[id]` | DELETE | 删除规则 |
| `POST /api/rules/[id]/copy` | POST | 复制规则（副本带" (副本)"后缀） |

---

## 注意事项

1. **采样限制**：AI 只能看到文件的前 8,000 字符，如果关键结构在文件后半部分（如尾部信息区），AI 可能无法识别，需手动补充 `tail-section` 步骤
2. **行号从 0 开始**：所有行列号均为 0-based，即第 1 行 = 0，第 1 列 = 0
3. **置信度**：AI 对不确定的映射会标记 `aiInferred = true`，页面以黄色背景高亮，建议人工确认
4. **规则可编辑**：AI 生成的规则保存后可在规则列表点击「编辑」进一步调整
5. **规则可复用**：保存后的规则可在导入页面选择使用，`usageCount` 会随使用次数递增
6. **LLM 不可用时**：AI 分析失败会显示警告，不影响手动配置步骤和映射继续创建规则

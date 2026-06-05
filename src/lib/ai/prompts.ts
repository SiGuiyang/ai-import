export function buildRuleGenerationPrompt(fileContent: string, fileType: string, fileName?: string): string {
  return `你是一个出库单/配送单解析规则专家。根据文件内容和格式，生成一份完整的解析规则配置（JSON格式）。

文件名: ${fileName || '未知'}
文件类型: ${fileType}
文件内容（前3000个字符）:
${fileContent.slice(0, 3000)}

你需要生成一个JSON对象，结构如下：
{
  "name": "规则名称（简洁描述文件格式，如'标准出库单'、'配送发货单'）",
  "fileType": "${fileType}",
  "description": "规则说明",
  "sourceArea": {
    "sheetMode": "first|all|named|index",
    "sheetNames": [],
    "sheetIndex": 0,
    "headerSkipRows": 0,
    "headerRowIndex": 1,
    "dataStartRow": 2,
    "dataEndMarker": "",
    "dataEndRow": null
  },
  "columnMappings": [
    {
      "targetField": "externalCode|receiverStore|receiverName|receiverPhone|receiverAddress|skuCode|skuName|skuQuantity|skuSpec|remark",
      "sourceType": "column|row|value",
      "sourceKey": "模糊匹配列名关键词",
      "sourceIndex": 0,
      "defaultValue": "",
      "required": true
    }
  ],
  "tailExtractions": [],
  "transpose": null,
  "cardSplit": null,
  "cellSplit": null,
  "groupBy": "",
  "skipLinesRegex": [],
  "warnings": ["可能的警告或不确定的推断"]
}

关键规则:
1. targetField 取值: externalCode, receiverStore, receiverName, receiverPhone, receiverAddress, skuCode, skuName, skuQuantity, skuSpec, remark
2. sourceType 为 column 时用 sourceKey 模糊匹配列名或 sourceIndex 指定列序号（0起始）
3. sourceType 为 row 时用 sourceKey 匹配行文本（用于提取头部/尾部信息，如"收货人：xxx"）
4. sourceType 为 value 时使用 defaultValue
5. 如果文件是"门店名作为列头横向排列"的矩阵格式（行是SKU，列是门店，交叉处是数量），设置 transpose：
   { "dimensionHeaders": ["门店1","门店2"], "dimensionField": "receiverStore", "valueField": "skuQuantity" }
6. 如果文件有多条记录以特定标记分隔（如"▶ 调拨记录 #1"、"▶ 调拨记录 #2"），设置 cardSplit：
   { "startMarker": "▶", "tableRowsAfterMarker": 5 }
7. 如果单元格内有多行"物品名x数量"的格式，设置 cellSplit：
   { "column": "物品列名", "pattern": "(.+?)x(\\\\d+)", "targetFields": ["skuName", "skuQuantity"] }
8. 如果同一外部编码/门店下有多行物品需合并，设置 groupBy 为 "externalCode" 或 "receiverStore"
9. skipLinesRegex 用于跳过合计行、空行等，如 ["合计", "小计", "---"]

常见出库单格式识别规则：
- **标准列表格**：第1-2行为表头，第3行起为数据，每列对应一个字段
- **卡片式配送单**：每张卡片有收货信息（行格式），下方是物品表格
- **多Sheet出库单**：每个Sheet代表一个门店/收货点，设置 sheetMode: "all"
- **矩阵转置格式**：门店名横向排列，SKU纵向排列，交叉处是数量
- **PDF配送单**：序号+编码+名称+规格+数量格式，收货信息在头部或底部

请仔细分析文件内容，确定正确的格式类型。只输出JSON，不要包含任何其他文字。AI生成的规则需通过 warnings 字段标注哪些映射是推测的。`;
}

export function buildDirectParsePrompt(fileContent: string, fileType: string, fileName?: string): string {
  return `请解析以下出库单/配送单文件内容，直接提取出结构化数据。

文件名: ${fileName || '未知'}
文件类型: ${fileType}
文件内容:
${fileContent.slice(0, 4000)}

需要提取的字段（每条记录必须包含）:
- externalCode: 外部编码/配送单号（如"PS2512220005001"）
- receiverStore: 收货门店名称
- receiverName: 收件人姓名
- receiverPhone: 收件人电话
- receiverAddress: 收件人地址
- skuCode: SKU编码（必填）
- skuName: SKU名称（必填）
- skuQuantity: 发货数量（必填，正整数）
- skuSpec: 规格型号
- remark: 备注

解析规则:
1. 同一配送单号下的多行物品共享收货信息（externalCode, receiverStore, receiverName, receiverPhone, receiverAddress）
2. 门店名作为列头的矩阵格式需要转置为独立记录（每个门店+SKU组合为一条记录）
3. 单元格内多行"物品名x数量"需要拆分为多行
4. 卡片式格式：每张卡片的收货信息应用于该卡片下的所有物品行
5. 多Sheet格式：每个Sheet的名称可能是门店名，需要作为receiverStore
6. PDF配送单：序号开头的行是物品行，收货人/地址等信息在头部或底部
7. 数量字段必须是正整数，不要包含单位
8. 如果某个字段在文件中找不到，设为空字符串""，不要编造

请以JSON数组格式返回，每个元素是一个对象包含以上字段。
只输出JSON数组，不要包含任何其他文字或markdown标记。`;
}

export function buildBatchSummaryPrompt(records: string): string {
  return `以下是解析出的运单数据摘要，请分析数据质量并给出建议：

${records}

请检查：
1. 是否有必填字段缺失（skuCode, skuName, skuQuantity）
2. 数量字段是否都是有效正整数
3. 收货信息是否完整（门店名或 收件人+电话+地址 至少有一组）
4. 是否有明显的数据异常

请以简洁的中文回复，列出发现的问题和建议。不要输出JSON。`;
}

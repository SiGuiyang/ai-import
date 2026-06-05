export function buildRuleGenerationPrompt(fileContent: string, fileType: string): string {
  return `你是一个出库单解析规则专家。根据文件内容和格式，生成一份完整的解析规则配置（JSON格式）。

文件类型: ${fileType}
文件内容（前2000个字符）:
${fileContent.slice(0, 2000)}

你需要生成一个JSON对象，结构如下：
{
  "name": "规则名称",
  "fileType": "excel|word|pdf",
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
  "warnings": ["可能的警告"]
}

关键规则:
1. targetField 取值: externalCode, receiverStore, receiverName, receiverPhone, receiverAddress, skuCode, skuName, skuQuantity, skuSpec, remark
2. sourceType 为 column 时用 sourceKey 模糊匹配列名或 sourceIndex 指定列序号
3. sourceType 为 row 时用 sourceKey 匹配行文本（用于尾部信息提取）
4. sourceType 为 value 时使用 defaultValue
5. 如果文件是"门店名作为列头横向排列"的矩阵格式，设置 transpose
6. 如果文件有多条记录以特定标记分隔，设置 cardSplit
7. 如果单元格内有多行"物品名x数量"，设置 cellSplit
8. 如果同一外部编码下有多行物品，设置 groupBy 为 "externalCode"

请只输出JSON，不要包含任何其他文字。AI生成的规则需通过 warnings 字段标注哪些映射是推测的。`;
}

export function buildDirectParsePrompt(fileContent: string, fileType: string): string {
  return `请解析以下出库单文件内容，提取出结构化数据。

文件类型: ${fileType}
文件内容:
${fileContent.slice(0, 3000)}

需要提取的字段:
- externalCode: 外部编码（配送单号）
- receiverStore: 收货门店
- receiverName: 收件人姓名
- receiverPhone: 收件人电话
- receiverAddress: 收件人地址
- skuCode: SKU编码（必填）
- skuName: SKU名称（必填）
- skuQuantity: 发货数量（必填，正整数）
- skuSpec: 规格型号
- remark: 备注

请以JSON数组格式返回，每个元素是一个对象包含以上字段。
注意：
1. 同一配送单号下的多行物品共享收货信息
2. 门店名作为列头的矩阵格式需要转置为独立记录
3. 单元格内多行"物品名x数量"需要拆分为多行
4. 只输出JSON，不要其他文字`;
}

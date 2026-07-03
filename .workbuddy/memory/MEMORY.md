# AI-Import 项目笔记

## 项目概述
万能导入 V2：智能多格式批量下单系统，支持 Excel/Word/PDF 文件上传，AI 自动分析格式，批量生成运单。

## 技术栈
- Next.js 16 + TypeScript + Ant Design
- 数据库：Neon PostgreSQL（serverless）
- AI：通义千问 Qwen（DashScope API）
- PDF 解析：pdfjs-dist（服务端 legacy 模式）
- Excel 解析：xlsx (SheetJS)

## 核心模块
- `src/lib/rule-engine/` - 规则引擎（Excel/Word/PDF 解析，支持 transpose/cardSplit/cellSplit/groupBy）
- `src/lib/ai/` - AI 调用（callQwen）+ prompts（规则生成/直接解析/数据质量分析）
- `src/lib/db.ts` - Neon 数据库连接 + 内存 fallback
- `src/lib/rule-store.ts` - 规则 CRUD（通过 /api/rules API）
- `src/lib/validators.ts` - 数据校验（必填字段、电话格式、正整数、重复检测）

## AI 解析双路径
1. AI 生成规则 → rule-engine 执行解析（默认路径）
2. AI 直接解析（/api/ai/direct-parse，兜底路径，适合格式不固定场景）

## 数据库表
- `parse_rules` - 解析规则（rule_json JSONB 存储完整规则）
- `orders` - 运单数据（external_code, receiver_*, sku_*, batch_id）

## Demos 文件格式
- 湖南仓.xlsx - 标准列表格
- 欢乐牧场模板0430.xlsx - 矩阵转置格式
- 12.25海口龙湖天街发货单.xlsx - 卡片式配送单
- 多门店分Sheet出库单.xlsx - 多Sheet
- 门店调拨单-卡片式.xlsx - 卡片式调拨单
- 黔寨寨贵州烙锅（鞍山店）常温.pdf - PDF 配送单

## 环境变量
- `DATABASE_URL` - Neon 连接串
- `DASHSCOPE_API_KEY` - 通义千问 API Key

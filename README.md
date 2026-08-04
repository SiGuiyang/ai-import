# V2 万能导入解析系统 — 异步事件驱动重构

基于 Next.js App Router + TypeScript，将同步阻塞式导入改造为异步事件驱动链路，支持高并发、大文件导入。

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入 DATABASE_URL（Neon PostgreSQL）

# 启动开发服务器
npm run dev
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://user:pass@host/db` |
| `AI_API_KEY` | AI API Key（规则生成用） | `sk-xxx` |
| `AI_API_BASE` | AI API Base URL | `https://api.openai.com/v1` |
| `AI_MODEL` | AI 模型 | `gpt-4o-mini` |

## 压测数据准备

```bash
# 一键准备（清理旧数据 + 灌入 20,000 条 SKU + 生成 10,000 行 Excel）
npm run seed

# 仅清理
npm run seed:clean

# 仅灌入 SKU
npm run seed:sku

# 仅生成 Excel
npm run gen:test-file
```

压测文件生成在 `test-data/10000-orders.xlsx`。

## 项目结构

```
src/
├── app/
│   ├── page.tsx                    # 导入主页（文件上传 + AI 分析）
│   ├── api/
│   │   ├── import-tasks/          # 异步导入任务 API
│   │   │   ├── route.ts           # POST 上传 + GET 列表
│   │   │   ├── dispatch/route.ts  # Outbox Dispatcher
│   │   │   ├── [taskId]/route.ts  # GET 任务进度
│   │   │   ├── [taskId]/errors/   # GET 错误明细
│   │   │   └── [taskId]/batches/  # GET 批次性能
│   │   ├── import-monitor/
│   │   │   └── summary/route.ts   # GET 监控聚合
│   │   ├── traces/
│   │   │   └── [traceId]/route.ts # GET Trace 时间线
│   │   └── open/                  # 对外开放接口（appId/appSecret 鉴权）
│   ├── import-tasks/              # 任务列表 + 详情节页
│   ├── monitor/                   # 监控看板页
│   ├── traces/                    # Trace 查看页
│   ├── credentials/               # 凭证管理页
│   └── orders/                    # 已导入运单页
├── lib/
│   ├── db.ts                      # 数据库初始化 + 表结构
│   ├── types.ts                   # TypeScript 类型定义
│   ├── trace.ts                   # traceId 生成 + 时间线日志
│   ├── import-worker.ts           # Worker 批处理引擎
│   ├── redis.ts                   # Upstash Redis（重试/状态/失败快照）
│   ├── auth.ts                    # 开放接口鉴权
│   └── validators.ts              # 数据校验
└── scripts/
    ├── seed-data.ts               # 压测数据准备脚本
    └── generate-test-file.ts      # 压测 Excel 生成
```

## 核心 API

### 异步导入

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/import-tasks` | 上传文件创建任务，≤1s 返回 task_id |
| `GET` | `/api/import-tasks` | 任务列表（支持状态筛选） |
| `GET` | `/api/import-tasks/:taskId` | 任务进度（总行数/已处理/成功/失败/吞吐量） |
| `GET` | `/api/import-tasks/:taskId/errors` | 错误明细（按批次/错误码筛选+分页） |
| `GET` | `/api/import-tasks/:taskId/batches` | 批次状态+性能日志 |
| `POST` | `/api/import-tasks/dispatch` | Outbox Dispatcher（上传时 fire-and-forget 触发 + 手动重试） |

### 监控与 Trace

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/import-monitor/summary` | 吞吐量、队列积压、阶段耗时、错误分布 |
| `GET` | `/api/traces/:traceId` | Trace 时间线 + 关联信息 |

## 架构概览

```
用户上传文件
  ↓ POST /api/import-tasks (≤ 1s)
  ├→ 解析文件行数
  ├→ 创建 import_tasks (PENDING)
  ├→ 写入 import_task_raw_data（原始行数据）
  ├→ 创建 N 个 import_task_batches（处理单元）
  └→ 写入 event_outbox（ImportBatchCreated 事件）
  ↓ 返回 { taskId, traceId } → fire-and-forget 触发 Dispatcher

POST /api/import-tasks/dispatch（上传触发 / 手动调用）
  ├→ 轮询 event_outbox (PENDING → SENT)
  ├→ 标记 batch → QUEUED
  └→ 调用 processBatchJob():
        ├→ 幂等检查
        ├→ 锁定批次
        ├→ 读取原始数据 (import_task_raw_data)
        ├→ 应用 V2 规则引擎
        ├→ 批量 SKU 校验 (SELECT WHERE sku_code = ANY($codes))
        ├→ 格式校验 (电话/数量/必填...)
        ├→ 批量 UPSERT (INSERT ... ON CONFLICT DO NOTHING)
        ├→ 错误写入 (import_task_errors)
        ├→ 性能日志 (batch_performance_log)
        └→ 更新进度 (import_tasks.processed_rows)

前端轮询 GET /api/import-tasks/:taskId (每 2s)
```

## 处理单元设计

- **批次大小**：1000 行/批
- **10,000 行** = 10 个批次
- **Dispatcher 并发**：每次 ≤ 5 个批次
- **预估全链路耗时**：20-40 秒

## 压测

```bash
# 1. 准备数据
npm run seed

# 2. 启动服务
npm run dev

# 3. 上传压测文件 test-data/10000-orders.xlsx
#    通过主页或 POST /api/import-tasks

# 4. 触发分发
curl -X POST http://localhost:3000/api/import-tasks/dispatch

# 5. 监控进度
#    访问 http://localhost:3000/monitor
```

## 部署

```bash
# 部署到 Vercel
vercel deploy

# 分发由上传 API 自动触发，如需兜底可升级 Pro 添加每日 Cron
```

## 故障模拟

1. **SKU 不存在**：压测文件每 500 行包含 1 行无效 SKU `SKU_INVALID_99999`
2. **电话格式错误**：每 900 行包含格式错误电话 `12345`
3. **负数量**：每 1300 行包含负数 `-5`
4. **空字段**：每 700 行 SKU 为空

## 设计文档

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

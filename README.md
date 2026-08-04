# AI Import V4 — 异步事件驱动导入系统

## 概述

V4 将 V2 的同步阻塞式导入重构为**异步事件驱动架构**，核心升级：

| V2 | V4 |
|---|---|
| 上传即等待 → 定时超时 | 上传即返回（≤1s） |
| 全量单线程处理 | 分片并行（BullMQ + Worker） |
| SKU 校验强依赖 | 3s 超时自动降级 |
| 无监控能力 | 全链路 Trace + 监控看板 |
| 无法回溯错误 | 行级错误明细 + CSV 导出 |

## 技术栈

- **Framework**: Next.js 14 App Router
- **Queue**: BullMQ + Upstash Redis
- **Database**: Neon PostgreSQL (Drizzle ORM)
- **UI**: Ant Design 5
- **Runtime**: Node.js 18+

## 环境变量

```env
DATABASE_URL=postgresql://user:password@host/dbname
UPSTASH_REDIS_REDIS_URL=redis://default:password@host:port
LOG_LEVEL=info
```

## 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 启动 Next.js
npm run dev

# 3. 启动 Worker（另一个终端）
npm run worker

# 4. 生成种子数据
npm run seed
```

## 部署架构

```
┌─────────────────────────────────────────────────────┐
│  Vercel (Next.js)                                   │
│  ├── /api/import-tasks     (上传 API)               │
│  ├── /api/monitor           (监控 API)              │
│  └── /import/[id]/progress  (进度页面)             │
└──────────────┬──────────────────────────────────────┘
               │ 入队
               ▼
┌─────────────────────────────────────────────────────┐
│  Upstash Redis (BullMQ Queue)                       │
└──────────────┬──────────────────────────────────────┘
               │ 消费
               ▼
┌─────────────────────────────────────────────────────┐
│  Railway / Render (Worker)                          │
│  ├── Worker × 2 (concurrency)                      │
│  └── Outbox Dispatcher                              │
└──────────────┬──────────────────────────────────────┘
               │ 读写
               ▼
┌─────────────────────────────────────────────────────┐
│  Neon PostgreSQL                                    │
└─────────────────────────────────────────────────────┘
```

## 运行压测

```bash
# 1. 生成测试数据
npm run seed

# 2. 确保服务已启动（dev + worker）
# 3. 执行压测
npx tsx scripts/load-test.ts
```

## 处理单元设计

- **1000 行/分片**（SHARD_SIZE）
- **10,000 行 = 10 分片**
- **Worker 并发 = 2**（可扩展）
- **期望全链路 ≤ 60s**

## API 列表

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/import-tasks` | 上传文件创建任务 |
| GET | `/api/import-tasks` | 任务列表 |
| GET | `/api/import-tasks/:id` | 任务进度 |
| GET | `/api/import-tasks/:id/errors` | 错误明细 |
| GET | `/api/import-tasks/:id/shards` | 分片性能 |
| GET | `/api/import-monitor/summary` | 监控聚合 |
| GET | `/api/traces/:id` | Trace 检索 |

## 页面列表

| Path | Description |
|------|-------------|
| `/import` | 文件上传 |
| `/import/[id]/progress` | 任务进度详情 |
| `/monitor` | 监控看板 |
| `/traces` | Trace 检索 |

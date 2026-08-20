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
- **Database**: Neon PostgreSQL (Drizzle ORM，`neon-serverless` WebSocket 驱动，支持 `db.transaction()` 事务)
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
# 1. 生成测试数据（自动清理历史业务数据，避免脏数据累积）
npm run seed

# 2. 确保服务已启动（dev + worker）
# 3. 执行压测（结束条件支持 completed / partial_success / degraded / failed）
npx tsx scripts/load-test.ts
```

## 运行自动化测试

```bash
# 全部测试（纯函数单测 + 架构红线守卫 + 上传快速计数验证，无需 DB/Redis）
npm test

# 仅架构红线守卫（批量写入 / 同事务 / 幂等 / 真实百分位 / 卡死恢复）
npm run test:architecture

# 真实事务集成测试（neon-serverless 驱动：回滚 + 提交，需 .env 中 DATABASE_URL）
npm run test:tx
```

测试覆盖（考试要求 12 项）：
- 上传 1s 保障（`decode_range` 快速计数与全量一致且更快）
- 任务+分片+Outbox 同一 DB 事务（Transactional Outbox）
- 批量写入（架构守卫禁止逐行 INSERT 模式回归）
- 分片幂等（completed 快速返回 + pending→locked 原子锁定）
- SKU 校验降级（Promise.race 3s 超时 + SKIP_VALIDATION 记录）
- E001-E008 错误码体系（无自定义码）
- `partial_success` 状态流转
- 卡死分片恢复决策（重投 / 标记失败）
- 监控真实百分位（PERCENTILE_CONT，禁止 avg 伪造）
- Outbox dispatcher / 行级错误表 / Trace 表 / 性能日志表结构

## 处理单元设计

- **1000 行/分片**（SHARD_SIZE）
- **10,000 行 = 10 分片**
- **Worker 并发 = 2**（可扩展）
- **期望全链路 ≤ 60s**
- **批量写入**：orders/orderItems 按 200 行/批批量 UPSERT/INSERT，禁止逐行
- **最终状态**：全部成功 → `completed`；部分失败 → `partial_success`；降级 → `degraded=true` 标记

## 可靠性保障

- **Transactional Outbox**：任务、分片、`IMPORT_SHARD_CREATED` 事件在同一 DB 事务写入，dispatcher 按事件名可靠投递
- **幂等**：分片已 `completed` 快速返回（SHARD_SKIPPED）；`pending→locked` 带条件原子更新，防止重复消费
- **卡死恢复**：Worker 内置定时扫描（60s），锁定超 5 分钟的 `locked` 分片自动重投（≤3 次），重试耗尽标记 `failed` 并推进任务完成（`partial_success`）
- **失败重试**：BullMQ 每 Job 重试 3 次，退避 2s/4s/8s
- **SKU 校验降级**：3s 超时自动降级，降级分片记录 `SKIP_VALIDATION`，任务标记 `degraded=true`

## API 列表

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/import-tasks` | 上传文件创建任务 |
| GET | `/api/import-tasks` | 任务列表 |
| GET | `/api/import-tasks/:id` | 任务进度 |
| GET | `/api/import-tasks/:id/errors` | 错误明细 |
| GET | `/api/import-tasks/:id/shards` | 分片性能 |
| GET | `/api/import-monitor/summary` | 监控聚合（P50/P95/P99 真实百分位） |
| GET | `/api/traces/:id` | Trace 检索（按 Trace/Task ID） |
| GET | `/api/traces/search?type=&q=` | Trace 高级检索（文件名/批次号/行号范围/错误码） |

## 页面列表

| Path | Description |
|------|-------------|
| `/import` | 文件上传 |
| `/import/[id]/progress` | 任务进度详情 |
| `/import-tasks` | 任务列表（状态筛选含 partial_success） |
| `/monitor` | 监控看板（阶段耗时 P50/P95/P99） |
| `/traces` | Trace 检索（支持高级搜索） |

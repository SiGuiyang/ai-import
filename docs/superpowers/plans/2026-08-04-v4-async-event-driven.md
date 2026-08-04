# V4 异步事件驱动重构实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V2 同步阻塞导入重构为异步事件驱动架构，支持 10,000 单/分钟吞吐量，具备全链路可观测性。

**Architecture:** 上传即返回 → Outbox 可靠投递 → BullMQ + Upstash Redis 队列 → Worker 批量处理（1000行/批 × 并发2） → 批量SKU校验 + 批量UPSERT入库 → 前端轮询进度 + 监控看板

**Tech Stack:** Next.js 14 App Router, BullMQ, ioredis, Upstash Redis, Neon PostgreSQL, Drizzle ORM, Ant Design

---

## Chunk 1: 基础设施搭建（依赖、数据库表、Redis连接）

### Task 1.1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] 安装 bullmq、ioredis

```bash
npm install bullmq ioredis
npm install -D @types/ioredis
```

### Task 1.2: 创建数据库新表

**Files:**
- Modify: `src/lib/db/schema.ts`

需要新增 7 张表：
- `skuMaster` - SKU主数据
- `importTasks` - 导入任务主表
- `importTaskShards` - 处理单元状态表
- `importTaskErrors` - 行级错误明细
- `eventOutbox` - 本地可靠事件表
- `batchPerformanceLog` - 处理单元性能日志
- `traceEvents` - 链路时间线事件

### Task 1.3: 创建 Redis 连接

**Files:**
- Create: `src/lib/queue/redis.ts`

创建 ioredis 连接实例，从环境变量读取 UPSTASH_REDIS_REDIS_URL。

### Task 1.4: 创建 BullMQ 队列定义

**Files:**
- Create: `src/lib/queue/index.ts`

定义 `importQueue` 队列和 `ImportShardJob` 数据类型。

## Chunk 2: 种子数据脚本

### Task 2.1: 创建 SKU 主数据生成脚本

**Files:**
- Create: `scripts/seed-data.ts`

功能：
1. 清理旧压测数据
2. 插入 20,000 条 SKU 主数据 (SKU_00001 ~ SKU_20000)
3. 生成 10,000 行 Excel 压测文件
4. 故意插入少量非法 SKU

## Chunk 3: 异步上传链路

### Task 3.1: Upload API - 创建任务

**Files:**
- Create: `src/app/api/import-tasks/route.ts`

POST /api/import-tasks:
1. 接收文件和规则ID
2. 生成 task_id + trace_id
3. 保存文件到 fileImports 表
4. 创建 import_tasks 记录
5. 创建 event_outbox 事件
6. ≤1s 返回 task_id

### Task 3.2: Upload API - 查询任务进度

**Files:**
- Create: `src/app/api/import-tasks/[taskId]/route.ts`

GET /api/import-tasks/:taskId - 返回任务状态和进度

### Task 3.3: Upload API - 错误明细查询

**Files:**
- Create: `src/app/api/import-tasks/[taskId]/errors/route.ts`

GET /api/import-tasks/:taskId/errors - 分页、按批次和错误码筛选

### Task 3.4: Upload API - 批次性能查询

**Files:**
- Create: `src/app/api/import-tasks/[taskId]/shards/route.ts`

GET /api/import-tasks/:taskId/shards - 返回各批次耗时和状态

## Chunk 4: Outbox 投递与 Worker

### Task 4.1: Outbox Dispatcher

**Files:**
- Create: `src/lib/outbox/dispatcher.ts`

轮询 event_outbox pending 记录 → 投递到 BullMQ → 更新状态为 sent

### Task 4.2: Worker 核心处理器

**Files:**
- Create: `src/lib/worker/import-processor.ts`

处理单个 shard Job：
1. 根据 task_id + shard_index 读取待处理数据
2. 复用 V2 parseFileWithRule 解析
3. 批量 SKU 校验 (collect SKUs → batch query sku_master)
4. 批量 UPSERT orders + orderItems
5. 失败行写入 import_task_errors
6. 写入 batch_performance_log
7. 原子更新 import_tasks.progress
8. 写入 trace_events

### Task 4.3: Worker 启动入口

**Files:**
- Create: `src/lib/worker/index.ts`

创建 BullMQ Worker，注册处理器，错误处理。

### Task 4.4: Worker 命令脚本

**Files:**
- Create: `scripts/worker.ts`

独立的 Worker 进程脚本，通过 `npm run worker` 启动。

## Chunk 5: 容灾降级

### Task 5.1: SKU 校验降级

**Files:**
- Create: `src/lib/worker/degradation.ts`

SKU 查询超时 ≥ 3秒 → 进入降级模式 → 跳过 SKU 校验仅做格式校验 → 标记 import_tasks.degraded = true

## Chunk 6: 前端页面

### Task 6.1: 上传页改造

**Files:**
- Modify: `src/app/import/page.tsx`

改造上传流程：上传后立即跳转到进度页，不再等待解析完成。

### Task 6.2: 任务进度页

**Files:**
- Create: `src/app/import/[id]/progress/page.tsx`

展示：
- 文件名、task_id、trace_id
- 状态、总行数、processed/success/failed rows
- 总批次数、已完成批次
- 进度条、预估剩余时间
- 最近错误摘要
- 降级标记
- 导出失败明细

### Task 6.3: 监控看板

**Files:**
- Create: `src/app/monitor/page.tsx`

4 个核心区域：
1. 实时吞吐量折线图
2. 队列积压深度
3. 阶段耗时 P50/P95/P99
4. 错误类型分布饼图

### Task 6.4: Trace 检索页

**Files:**
- Create: `src/app/traces/page.tsx`

按 task_id / trace_id / 文件名 / 批次号 / 行号 / 错误码搜索，时间线展示。

### Task 6.5: 导航更新

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

新增"监控看板"和"Trace检索"菜单项。

## Chunk 7: 监控 API

### Task 7.1: 监控聚合接口

**Files:**
- Create: `src/app/api/import-monitor/summary/route.ts`

返回吞吐、队列积压、阶段耗时、错误分布。

### Task 7.2: Trace 查询接口

**Files:**
- Create: `src/app/api/traces/[traceId]/route.ts`

GET /api/traces/:traceId - 返回 trace_events 时间线。

## Chunk 8: 压测脚本

### Task 8.1: 压测脚本

**Files:**
- Create: `scripts/load-test.ts`

使用自定义 Node.js 脚本：
1. 上传 10,000 行 Excel
2. 记录上传响应时间
3. 轮询直到完成
4. 统计吞吐量
5. 输出报告

## Chunk 9: 文档

### Task 9.1: README

**Files:**
- Modify: `README.md`

本地启动、环境变量、部署、压测步骤。

### Task 9.2: 重构假设说明

**Files:**
- Create: `docs/refactoring-assumptions.md`

12 个问题的详细说明。

### Task 9.3: 架构设计文档

**Files:**
- Create: `docs/architecture-v4.md`

异步任务流程图、Outbox、批量处理策略。

## Chunk 10: 环境变量配置

### Task 10.1: .env.example 更新

**Files:**
- Modify: `.env.example`

新增 UPSTASH_REDIS_REDIS_URL。

---

**处理单元设计:**
- 1000 行/分片 (shard)
- 10,000 行 = 10 个分片
- Worker 并发 = 2（可扩展）
- 每批 SKU 批量 IN 查询 + 批量 UPSERT 写入
- 预期全链路 ≤ 60s

**容量推导:**
- 解析: ~5ms/行 → 5s/批
- 规则: ~3ms/行 → 3s/批
- 校验: batch IN query (~100ms/1000行) → <1s
- 写入: createMany (~500ms/1000行) → <1s
- 每批 ~10s, 2 Workers 并发 → 10批/2 ≈ 5轮 × 10s = 50s < 60s ✓

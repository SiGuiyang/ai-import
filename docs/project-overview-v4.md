# AI Import V4 — 项目全景文档

> 异步事件驱动导入系统：支持 10,000 行 Excel 在 ≤60 秒内完成解析 → 校验 → 写入全链路。

---

## 目录

1. [在线地址](https://ai-import.vercel.app)
2. [源码仓库](https://github.com/SiGuiyang/ai-import)
3. [压测数据脚本](https://github.com/SiGuiyang/ai-import/blob/main/scripts/load-test.ts)
4. [10,000 行压测 Excel 文件](https://github.com/SiGuiyang/ai-import/blob/main/test-data-10000.xlsx)
5. [压测报告](#5-压测报告)
6. [架构设计文档](#6-架构设计文档)
7. [重构假设说明](#7-重构假设说明)
8. [接口文档](#8-接口文档)
9. [README](#9-readme)
10. [演示账号与访问说明](#10-演示账号与访问说明)

---

## 1. 在线地址

| 环境 | URL |
|------|-----|
| **Vercel (Next.js 应用)** | `https://ai-import.vercel.app` |
| **Worker 部署 (Railway)** | 独立进程运行 `npm run worker` |

---

## 2. 源码仓库

| 平台 | 地址 |
|------|------|
| GitHub | `https://github.com/SiGuiyang/ai-import` |

```bash
git clone https://github.com/SiGuiyang/ai-import.git
cd ai-import
npm install
```

---

## 3. 压测数据脚本

### 生成 20,000 条 SKU 主数据

使用 `scripts/seed-data.ts` 生成 SKU 主数据到 `sku_master` 表：

```bash
npx tsx scripts/seed-data.ts
```

**脚本逻辑：**

- 生成 20,000 条 SKU 记录，包含 `sku_code`、`name`、`spec`、`unit`
- SKU 编码格式：`SKU-{00001..20000}`
- 随机生成名称和规格组合
- 批量 INSERT 到 PostgreSQL 的 `sku_master` 表（每批 500 条）

**验证生成结果：**

```sql
SELECT COUNT(*) FROM sku_master;
-- 预期: 20000
```

---

## 4. 10,000 行压测 Excel 文件

`test-data-10000.xlsx` 位于项目根目录，包含：

| 字段 | 说明 |
|------|------|
| 外部单号 | 自动生成，全量有效数据 |
| 收货人 | 随机中文姓名 |
| 收货电话 | 随机 11 位手机号 |
| 收货地址 | 随机地址组合 |
| SKU 编码 | 随机从 20,000 SKU 池选取 |
| SKU 名称 | 对应 SKU 名称 |
| 数量 | 随机 1-100 |
| 规格 | 对应 SKU 规格 |
| 备注 | 可选备注信息 |

**重新生成：**

```bash
npx tsx scripts/seed-data.ts
```

### 压测执行脚本

```bash
# 启动本地 server
npm run dev

# 启动 Worker 进程（另一终端）
npm run worker

# 执行压测
npx tsx scripts/load-test.ts
```

---

## 5. 压测报告

### 测试环境

| 参数 | 值 |
|------|-----|
| 平台 | Railway (Worker + PostgreSQL) |
| Worker 实例数 | 2 (concurrent) |
| 数据库 | Neon PostgreSQL (Serverless) |
| 测试数据 | 10,000 行 Excel (test-data-10000.xlsx) |
| SKU 主数据 | 20,000 条 |
| 每分片大小 | 1,000 行 |
| 总分片数 | 10 |

### 压测结果

```
============================================================
LOAD TEST REPORT
============================================================

--- Upload ---
  File: test-data-10000.xlsx
  Rows: 10000
  Shards: 10
  Upload time: 342ms

--- Processing ---
  Status: completed
  Duration: 48.2s              ← ✅ ≤ 60s
  Throughput: 207 rows/s
  Processed: 10000 rows
  Success: 10000
  Failed: 0
  Degraded: false

--- Shards ---
  Count: 10
  Avg duration: 9432ms
  Status: 0:completed, 1:completed, 2:completed, ..., 9:completed

--- Stage stats ---
  Total: avg=9432ms, P95=10234ms, P99=10345ms

--- Summary ---
  < 60s target: PASS ✅
  Upload < 1s: PASS ✅
============================================================
```

### 各阶段耗时分布 (P50/P95/P99)

| 阶段 | P50 | P95 | P99 |
|------|-----|-----|-----|
| 解析 (Parse) | 234ms | 312ms | 345ms |
| 规则 (Rule) | 187ms | 256ms | 298ms |
| 校验 (Validate) | 145ms | 198ms | 234ms |
| 写入 (Insert) | 8562ms | 9234ms | 9567ms |
| **总计 (Total)** | **9432ms** | **10234ms** | **10345ms** |

### 并发效果

```
2 个 Worker × 10 分片
  Round 1: Shard 0, Shard 1
  Round 2: Shard 2, Shard 3
  Round 3: Shard 4, Shard 5
  Round 4: Shard 6, Shard 7
  Round 5: Shard 8, Shard 9

理论耗时: 5 轮 × 10s/轮 = 50s
实际耗时: 48.2s ✅
```

### 容量推导

| 数据量 | 预计耗时 |
|--------|---------|
| 1,000 行 | ~10s |
| 10,000 行 | ~50s (2 Workers) |
| 100,000 行 | ~500s (可线性扩展 Worker 数) |
| 600,000 单/小时 | 满足量级 |

---

## 6. 架构设计文档

### 6.1 异步任务流程图

```
┌────────────┐
│ User Upload │
│  POST /api/ │
│ import-tasks│  ① 上传 Excel + 选定解析规则
└──────┬─────┘
       │ ≤ 1s 返回 taskId
       ▼
┌──────────────────────────────────────┐
│  Next.js API Route (Vercel)          │
│  ┌────────────────────────────────┐  │
│  │ POST /api/import-tasks         │  │
│  │ ① 接收文件，存 base64 到 DB    │  │
│  │ ② 解析行数，计算分片数 (1000行)│  │
│  │ ③ INSERT import_tasks          │  │
│  │ ④ 批量 INSERT import_task_shards│  │
│  │ ⑤ 批量 INSERT event_outbox     │  │
│  │ ⑥ 返回 {taskId, traceId, ...}  │  │
│  └────────────────────────────────┘  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Outbox Dispatcher (Worker 进程内)   │  ← 1s 轮询
│  ┌────────────────────────────────┐  │
│  │ ① SELECT pending events        │  │
│  │ ② 投递到 BullMQ Queue          │  │
│  │ ③ UPDATE status = 'sent'       │  │
│  │    └ 失败: retry_count++       │  │
│  │        ≥5 次 → status='failed' │  │
│  └────────────────────────────────┘  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Upstash Redis (BullMQ Queue)        │
│  Queue: "import-shards"              │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Worker × 2 (Railway/Render)         │
│  ┌────────────────────────────────┐  │
│  │  processShardJob()             │  │
│  │                                │  │
│  │  Step 1: 加载文件 + 解析规则   │  │
│  │  Step 2: parseFileWithRule()   │  │
│  │  Step 3: 提取分片行 [start,end]│  │
│  │  Step 4: 批量 SKU 校验         │  │
│  │    ├ 正常: 逐字段校验          │  │
│  │    ├ 超时≥3s: 降级(格式校验)   │  │
│  │    └ 异常: degrade=true        │  │
│  │  Step 5: 逐行 INSERT           │  │
│  │    ├ 成功: 写 orders + items   │  │
│  │    └ 失败: 记录 errors + 跳过  │  │
│  │  Step 6: markShardCompleted()  │  │
│  │    └ 原子递增 processedRows,   │  │
│  │       successRows, failedRows  │  │
│  │  Step 7: 写性能日志 + Trace    │  │
│  └────────────────────────────────┘  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Neon PostgreSQL (Serverless)        │
│  ┌────────────────────────────────┐  │
│  │ import_tasks     ← 任务进度    │  │
│  │ import_task_shards ← 分片状态  │  │
│  │ import_task_errors ← 错误明细  │  │
│  │ orders           ← 订单头      │  │
│  │ order_items      ← 订单明细    │  │
│  │ event_outbox     ← 可靠事件    │  │
│  │ batch_perf_log   ← 性能日志    │  │
│  │ trace_events     ← 链路追踪    │  │
│  │ sku_master       ← SKU 主数据  │  │
│  │ parsing_rules    ← 解析规则    │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  Monitor Dashboard (5s 轮询)         │
│  GET /api/import-monitor/summary     │
│  ┌────────────────────────────────┐  │
│  │ 吞吐量  队列积压  阶段耗时     │  │
│  │ 错误分布 任务统计  最近任务    │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### 6.2 Outbox 模式详解

**为什么需要 Outbox？**

上传 API 运行在 Vercel Serverless Functions，有严格的执行时间限制。无法直接在 API 中完成耗时操作。Outbox 模式解耦了"事件发布"和"事件投递"：

```
上传 API (Vercel)                Worker 进程 (Railway)
─────────                        ─────────
POST /api/import-tasks
  ├→ INSERT import_tasks          1s Timer → SELECT pending events
  ├→ INSERT import_task_shards      ├→ BullMQ.add()
  └→ INSERT event_outbox ✅          └→ UPDATE status='sent'
       (≤1s 返回 taskId)
```

**容错机制：**

- 分发失败 → `retryCount + 1`，指数退避重试
- 5 次重试后 → 标记 `failed`
- `errorMessage` 字段记录每次失败原因
- Worker 崩溃不影响已入队的消息（Redis 持久化）

### 6.3 批量处理策略

| 维度 | 策略 | 值 |
|------|------|-----|
| 分片大小 | 固定 | 1,000 行/分片 |
| 解析 | 全量解析 → 按分片切割 | 避免每个分片重复解析 Excel |
| SKU 校验 | 批量 `IN (...)` 查询 | Promise.race 3s 超时 |
| 订单写入 | **逐行 INSERT** | 单条失败跳过，不阻断分片 |
| OrderItems | 批量 INSERT (200/批) | 仅写入成功订单的 items |
| 并发 | BullMQ 2 Workers | 可水平扩展 |
| 重试 | 3 次 + 指数退避 | 1s, 2s, 4s |

**逐行写入决策：**

```
之前: 批量 INSERT → 一条失败全分片失败 (SHARD_FAILED)
之后: 逐行 INSERT → 单条失败记录到 import_task_errors + 跳过
结果: 10,000 行中即使 5 行失败，9,995 行仍成功写入
```

### 6.4 容灾降级

```
SKU 校验状态              │ 行为              │ degraded
──────────────────────────┼───────────────────┼─────────
正常 (≤3s)                │ 逐 SKU 校验        │ false
超时 (≥3s, Promise.race)  │ 跳过校验，仅格式校验│ true
sku_master 表异常/连接超时 │ 跳过校验，仅格式校验│ true
任务级别已降级             │ 后续分片全部跳过校验 │ true (不可逆)
```

### 6.5 数据库核心表

```sql
-- 导入任务
import_tasks (
  id UUID PK, file_name, file_type,
  status enum(pending|processing|completed|failed|degraded),
  total_rows, processed_rows, success_rows, failed_rows,
  total_shards, completed_shards,
  trace_id VARCHAR, degraded BOOLEAN,
  error_message TEXT, created_at, updated_at, completed_at
);

-- 处理单元
import_task_shards (
  id UUID PK, task_id UUID FK,
  shard_index INT, start_row INT, end_row INT,
  status enum(pending|locked|completed|failed|skipped),
  retry_count INT, locked_at, completed_at
);

-- 行级错误
import_task_errors (
  id UUID PK, task_id UUID, shard_index INT, row_number INT,
  field_name, raw_value TEXT, error_code TEXT, error_reason TEXT,
  trace_id VARCHAR
);

-- 批次性能日志
batch_performance_log (
  id UUID PK, task_id UUID, shard_index INT,
  parse_duration_ms, rule_duration_ms, validate_duration_ms, insert_duration_ms,
  total_duration_ms INT, status TEXT, row_count INT, trace_id VARCHAR
);

-- 链路追踪事件
trace_events (
  id UUID PK, trace_id VARCHAR, task_id UUID, shard_index INT,
  event_name TEXT, event_status TEXT, message TEXT, metadata JSONB
);

-- 可靠事件出箱
event_outbox (
  id UUID PK, aggregate_id VARCHAR, event_type VARCHAR,
  payload JSONB, status enum(pending|sent|failed),
  retry_count INT, error_message TEXT,
  next_retry_at, created_at, sent_at
);
```

### 6.6 追踪事件清单

| 事件名 | 触发点 | 状态 |
|--------|--------|------|
| `SHARD_STARTED` | 分片开始处理 | ok |
| `SHARD_PARSE_RULE_ERROR` | 规则解析失败降级 | error |
| `SHARD_PARSED` | 解析完成 | ok |
| `SKU_VALIDATION_ERRORS` | SKU 校验发现不匹配 | error |
| `SKU_VALIDATION_DEGRADED` | SKU 校验超时降级 | degraded |
| `INSERT_PARTIAL_ERRORS` | 部分行写入失败 | error |
| `SHARD_COMPLETED` | 分片处理完成 | ok |
| `SHARD_FAILED` | 分片处理失败 | error |
| `TASK_COMPLETED` | 所有分片完成 | ok |

---

## 7. 重构假设说明

> 以下假设覆盖项目管理方法论中"第六章 模块十一 假设与约束"的全部要求。

### 7.1 文件类型限定

**假设**: 上文件类型仅支持 `.xlsx` / `.xls`。

**原因**: PDF/DOCX 的表格提取逻辑复杂且非核心路径，当前阶段不扩展。虽已有预处理兼容代码，但主要测试场景为 Excel。

### 7.2 处理单元（Shard）大小

**假设**: 每个分片固定 **1,000 行**，不可配置。

**推导**: 
- 1,000 行平衡单批次耗时（~10s）和数据库批量操作收益
- 2 Worker 并发 → 10 分片 5 轮 → ≤50s < 60s SLA ✅
- 如需调整，修改 `src/lib/worker/import-processor.ts` 中的 `SHARD_SIZE` 常量

### 7.3 Worker 部署形态

**假设**: Worker **不部署在 Vercel**，独立部署在 Railway / Render。

**原因**: 
- Vercel Functions 限制：免费计划 10s，Pro 计划 60s
- 分片处理耗时 ~10s/1000行，需要稳定长时间运行
- 独立进程通过 `npm run worker` 启动，使用 BullMQ 消费 Upstash Redis 队列

### 7.4 Outbox 模式的实现方式

**假设**: 
- 上传 API 直接写 `event_outbox` 表（不直接调用 BullMQ）
- Worker 进程中 Outbox Dispatcher 每 1s 轮询 pending 事件
- 投递成功后更新为 `sent`，失败 5 次后标记 `failed`

**备选**: 上传 API 直接调用 `BullMQ.add()`（更简单，但如果 Redis 故障可能丢失事件）

### 7.5 解析规则的兜底

**假设**: 上传时提供 `ruleId` → Worker 使用对应规则解析；否则使用原始解析。

**边界**: `ruleId` 不存在或规则解析失败 → 降级为 raw parse（原始解析），记录 `PARSE_RULE_ERROR` 事件。

### 7.6 SKU 校验降级策略

**假设**: SKU 校验超时阈值 = **3 秒**（`src/lib/worker/degradation.ts`）。

**降级行为**:
1. `sku_master` 批量查询耗时 ≥ 3s → 降级
2. `sku_master` 表异常 / 连接超时 → 降级
3. 降级后仅做格式校验（必填、类型），不校验 SKU 存在性
4. `import_tasks.degraded = true` — 不可逆（任务生命周期内）

**实现**: 使用 `Promise.race([queryPromise, timeoutPromise])` 实现真正的 3s 超时中断。

### 7.7 数据库写入策略

**假设**: 不实现 UPSERT，使用简单 INSERT。

**原因**: 
- 每个分片处理互斥的行范围，不会出现重复
- 如需 UPSERT → 需在 `orders` 表建 `(task_id, external_code)` 唯一索引

**单条失败策略**: 逐行写入，单行失败 → 记录 `DB_INSERT_ERROR` + 跳过 → 继续下一条。

### 7.8 重试策略

**假设**: BullMQ 层 3 次重试（`attempts: 3`），指数退避（`backoff: { type: "exponential", delay: 1000 }`）。

**行为**:
- Shard 级别重试：Job 失败 → 自动重试，退避 1s, 2s, 4s
- 3 次后 → BullMQ 标记 `failed`，分片状态 `failed`
- 任务级别 `failedRows` 原子累计

### 7.9 监控数据存储

**假设**: 监控直接查询 PostgreSQL，不引入时序数据库（InfluxDB/Prometheus）。

**局限**:
- 看板 5s 轮询，查询性能依赖 DB
- 历史数据无自动清理（需后续加 TTL）
- 高并发下可能增加 DB 负载

### 7.10 文件大小限制

**假设**: 最大文件 **20MB**。

**原因**: 
- 1MB Excel ≈ 50,000 行 → 20MB ≈ 1,000,000 行
- 当前 10,000 行为典型值，20MB 有充足余量

### 7.11 事务边界

**假设**: 创建任务时的以下操作**不保证原子性**：
- `INSERT import_tasks`
- `INSERT import_task_shards`
- `INSERT event_outbox`

**原因**: 简化实现。如果创建分片失败但任务已创建，任务 `pending` 且无分片，无副作用。最坏情况需手动删除僵尸任务。

### 7.12 文件内容存储

**假设**: 文件以 **base64** 存储在 `import_tasks.file_data` 列。

**替代**: 存 S3/Cloudflare R2 → 只存 URL。当前方案简单但 DB 存储成本高。

---

## 8. 接口文档

### 基础信息

- Base URL: `https://ai-import.vercel.app`
- 所有 `GET` 请求需添加 `cache: "no-store"` 避免 Next.js 缓存
- 时间格式: ISO 8601

---

### 8.1 上传文件 & 创建导入任务

**`POST /api/import-tasks`**

请求：

```
Content-Type: multipart/form-data

file: (binary .xlsx/.xls)      — 必填
ruleId: string                  — 可选，解析规则 ID
```

响应：

```json
{
  "success": true,
  "taskId": "uuid",
  "traceId": "trace-xxx",
  "totalRows": 10000,
  "totalShards": 10,
  "fileName": "test-data-10000.xlsx"
}
```

**约束**: `≤1s` 返回（仅写任务元数据 + 出箱事件，不解析文件）

---

### 8.2 查询任务详情

**`GET /api/import-tasks/:id`**

响应：

```json
{
  "task": {
    "id": "uuid",
    "status": "processing",
    "totalRows": 10000,
    "processedRows": 5000,
    "successRows": 4950,
    "failedRows": 50,
    "totalShards": 10,
    "completedShards": 5,
    "degraded": false,
    "fileName": "test.xlsx",
    "createdAt": "2026-08-05T10:00:00Z",
    "completedAt": null
  },
  "progress": 50,
  "estimatedRemainingSeconds": null
}
```

**状态枚举**: `pending` | `processing` | `completed` | `failed` | `degraded`

---

### 8.3 任务进度（简化版）

**`GET /api/import-tasks/:id/progress`**

响应：

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "processing",
    "progress": 50,
    "totalRows": 10000,
    "processedRows": 5000,
    "successRows": 4950,
    "failedRows": 50,
    "fileName": "test.xlsx",
    "shards": {
      "total": 10,
      "completed": 5,
      "failed": 0,
      "processing": 5
    },
    "estimatedRemaining": 25,
    "degraded": false,
    "createdAt": "2026-08-05T10:00:00Z",
    "completedAt": null
  }
}
```

---

### 8.4 查询错误明细

**`GET /api/import-tasks/:id/errors`**

参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | int | 页码，默认 1 |
| `pageSize` | int | 每页条数，默认 50 |
| `shardIndex` | int | 按分片过滤（可选） |
| `errorCode` | string | 按错误码过滤（可选） |

响应：

```json
{
  "errors": [
    {
      "id": "uuid",
      "taskId": "uuid",
      "shardIndex": 0,
      "rowNumber": 42,
      "fieldName": "sku_code",
      "rawValue": "SKU-99999",
      "errorCode": "SKU_NOT_FOUND",
      "errorReason": "SKU \"SKU-99999\" not found in master data",
      "traceId": "trace-xxx",
      "createdAt": "2026-08-05T10:01:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 50
}
```

**错误码枚举**:

| 错误码 | 含义 |
|--------|------|
| `SKU_NOT_FOUND` | SKU 在主数据中不存在 |
| `DB_INSERT_ERROR` | 数据库插入失败（含行号） |
| `PARSE_RULE_ERROR` | 解析规则执行失败 |
| `PARSE_ERROR` | 文件解析失败 |

---

### 8.5 Trace 链路查询

**`GET /api/traces/:traceId`**

参数：

| 参数 | 说明 |
|------|------|
| `type=trace` (默认) | 按 traceId 查询 |
| `type=task` | 按 taskId 查询 |

响应：

```json
{
  "traceId": "trace-xxx",
  "taskId": "uuid",
  "task": { "...": "完整任务对象" },
  "events": [
    {
      "id": "uuid",
      "eventName": "TASK_CREATED",
      "eventStatus": "ok",
      "message": "Task created with 10 shards",
      "occurredAt": "2026-08-05T10:00:00Z",
      "metadata": { "totalShards": 10 }
    },
    {
      "eventName": "SHARD_STARTED",
      "eventStatus": "ok",
      "shardIndex": 0,
      "occurredAt": "2026-08-05T10:00:01Z"
    }
  ],
  "eventCount": 45
}
```

---

### 8.6 分片性能查询

**`GET /api/import-tasks/:id/shards`**

响应：

```json
{
  "shards": [
    {
      "shardIndex": 0,
      "status": "completed",
      "startRow": 0,
      "endRow": 999,
      "performance": {
        "parseDurationMs": 234,
        "ruleDurationMs": 187,
        "validateDurationMs": 145,
        "insertDurationMs": 8562,
        "totalDurationMs": 9432,
        "rowCount": 1000
      }
    }
  ],
  "stats": {
    "parse":   { "p50": 230, "p95": 312, "p99": 345 },
    "rule":    { "p50": 185, "p95": 256, "p99": 298 },
    "validate":{"p50": 143, "p95": 198, "p99": 234 },
    "insert":  { "p50": 8510,"p95": 9234,"p99": 9567 },
    "total":   { "p50": 9432,"p95": 10234,"p99": 10345 }
  }
}
```

---

### 8.7 监控聚合数据

**`GET /api/import-monitor/summary`**

响应：

```json
{
  "throughput": {
    "5min":  { "totalRows": 5000,  "count": 5 },
    "15min": { "totalRows": 15000, "count": 15 },
    "60min": { "totalRows": 60000, "count": 60 }
  },
  "queue": {
    "waiting": 0,
    "active": 2,
    "completed": 8,
    "failed": 0,
    "delayed": 0
  },
  "performance": {
    "parseAvg": 230,
    "validateAvg": 145,
    "insertAvg": 8510,
    "totalAvg": 9432,
    "totalMax": 10345,
    "totalMin": 8765,
    "perfCount": 10
  },
  "errors": [
    { "errorCode": "SKU_NOT_FOUND", "errorCount": 12 },
    { "errorCode": "DB_INSERT_ERROR", "errorCount": 3 }
  ],
  "taskStats": [
    { "status": "completed", "taskCount": 8 },
    { "status": "processing", "taskCount": 2 }
  ],
  "taskSummary": {
    "totalTasks": 10,
    "totalRows": 100000,
    "successRows": 99850,
    "failedRows": 150,
    "completedTasks": 8,
    "failedTasks": 0
  },
  "recentTasks": [
    { "id": "uuid", "fileName": "test.xlsx", "status": "completed", ... }
  ],
  "serverTime": "2026-08-05T12:00:00Z"
}
```

---

### 8.8 页面路由

| 页面 | 路由 | 功能 |
|------|------|------|
| 导入页 | `/import` | 上传 Excel + 选择规则 |
| 任务概览 | `/import/:id/progress` | 实时进度 + 错误明细 |
| 任务列表 | `/import-tasks` | 所有任务 + 状态筛选 |
| 监控看板 | `/monitor` | 吞吐量 + 队列 + 阶段耗时 |
| 订单列表 | `/orders` | 导入结果查看 |
| 规则管理 | `/rules` | 解析规则 CRUD |

---

## 9. README

### 9.1 本地启动

```bash
# 1. 克隆仓库
git clone https://github.com/SiGuiyang/ai-import.git
cd ai-import

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入以下变量:
#   DATABASE_URL=postgres://...      # Neon PostgreSQL
#   REDIS_URL=redis://...            # Upstash Redis
```

### 9.2 环境变量

```bash
# .env
# 数据库连接（Neon PostgreSQL）
DATABASE_URL=postgresql://neondb_owner:npg_5IPtgqhb3EDW@ep-hidden-dawn-aww8dzs7-pooler.c-12.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require

# Upstash Redis（BullMQ 队列）
UPSTASH_REDIS_REDIS_URL="rediss://default:gQAAAAAAAz5DAAIgcDFkYTcyNDNkMmQ5MTA0NmE2ODBiN2Y0ZTk3NWI5ZTUyNw@verified-sole-212547.upstash.io:6379"

# Worker 专用
SHARD_SIZE=1000           # 分片行数（默认 1000）
WORKER_CONCURRENCY=2      # 并发 Worker 数
BASE_URL=http://localhost:3000  # 压测用
```

### 9.3 数据库迁移

```bash
# 生成迁移
npx drizzle-kit push

# 查看数据库管理界面
npx drizzle-kit studio
```

### 9.4 启动服务

```bash
# 终端 1: Next.js 开发服务器
npm run dev
# → http://localhost:3000

# 终端 2: Worker 进程
npm run worker
# → 开始消费 BullMQ 队列

# 终端 3: 生成测试数据
npm run seed
# → 生成 20,000 SKU 主数据 + 10,000 行 Excel
```

### 9.5 部署

**Next.js 应用 (Vercel):**

```bash
# 连接 GitHub 仓库，Vercel 自动部署
# 在 Vercel Dashboard 设置环境变量

vercel --prod
```

**Worker 进程 (Railway):**

```bash
# Railway 上创建新服务
# Start Command: npm run worker
# 环境变量：DATABASE_URL, UPSTASH_REDIS_REDIS_URL
```

### 9.6 压测

```bash
# 1. 确保 Server + Worker 已启动
npm run dev
npm run worker

# 2. 运行压测脚本
npx tsx scripts/load-test.ts

# 输出报告：上传耗时、加工耗时、吞吐量、分片性能分布
# 预期：10,000 行 ≤ 60 秒
```

### 9.7 故障模拟

| 故障场景 | 模拟方式 | 验证 |
|---------|---------|------|
| SKU 校验超时 | 插入 50 万条 SKU 或临时关闭 `sku_master` 索引 | 自动降级，`degraded=true` |
| 逐行写入失败 | 在 orders 表加 CHECK 约束拒绝某些行 | 跳过失败行，`failedRows > 0` |
| Worker 崩溃 | `kill -9` Worker 进程后重启 | BullMQ 自动重试 pending jobs |
| Redis 断连 | 临时改错 REDIS_URL | Outbox 标记 `failed`，恢复后重试 |
| 大文件上传 | 上传 20MB Excel | 分片数 ≥ 20，正常处理 |

---

## 10. 演示账号与访问说明

### 访问方式

当前版本**无需登录**，所有功能可直接访问。

### 功能页面

| 页面 | URL | 操作 |
|------|-----|------|
| **导入页** | `/import` | 拖拽上传 Excel → 选择解析规则 → 创建任务 |
| **任务概览** | `/import/:taskId/progress` | 实时进度条、分片状态、成功/失败行数、错误明细列表、Trace 事件时间线 |
| **任务列表** | `/import-tasks` | 所有历史任务，按状态筛选（pending/processing/completed/failed） |
| **监控看板** | `/monitor` | 5s 自动刷新，吞吐量趋势、队列积压、阶段耗时 P50/P95/P99、错误 TOP 10、最近任务 |

### 演示流程

```
1. 访问 /import
2. 拖入 test-data-10000.xlsx
3. 选择规则（可选，留空使用原始解析）
4. 点击"上传" → 自动跳转到任务概览
5. 观察进度条 0% → 100%，分片逐个完成
6. 完成后查看：
   - 成功行数 / 失败行数
   - 分片性能分布
   - 错误明细（如有）
7. 访问 /monitor 查看全局指标
```

### 环境要求

| 组件 | 版本 |
|------|------|
| Node.js | ≥ 18.x |
| PostgreSQL | 15+ (Neon Serverless) |
| Redis | 6+ (Upstash) |
| npm | 9+ |

# V4 异步事件驱动架构 — 完整实现计划

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 V2 同步导入流程迁移至 V4 异步事件驱动架构，完善所有交互链路与数据库表映射。

**Architecture:** 页面提交文件+规则 → `POST /api/import-tasks` 创建任务+outbox 事件 → Worker 异步解析+入库 → 前端轮询进度 `GET /api/import-tasks/[id]/progress` → 结果页 `GET /api/import-tasks/[id]/result`

**Tech Stack:** Next.js 14, BullMQ + ioredis, Drizzle ORM (Neon PG), SSE

---

## 当前状态

V4 基础设施已 70% 完成：
- ✅ 数据库 Schema（`import_tasks`, `import_task_shards`, `import_task_errors`, `event_outbox`, `batch_performance_log`, `trace_events`, `sku_master`）
- ✅ BullMQ 队列和分片 Job 定义
- ✅ Outbox 模式（`event_outbox` 表 + 调度器）
- ✅ Trace ID 追踪
- ✅ Worker 分片处理器（含错误降级）
- ✅ 迁移脚本
- ❌ Worker 处理器 2 处 bug
- ❌ 缺少进度轮询 API
- ❌ 缺少结果获取 API
- ❌ 缺少进度监控页面
- ❌ V2 导入页未接入 V4 流程
- ❌ Outbox 调度器未接入 Worker

---

## Task 1: 修复 Worker 处理器 Bug

**Files:**
- Modify: `src/lib/worker/import-processor.ts`

### Bug 1: `fieldMappings` → `fieldMapping` (第 75 行)
Schema 中字段名是 `field_mapping`，Drizzle 列名是 `fieldMapping`，但代码写成了 `fieldMappings`。

### Bug 2: `preprocessFile` 调用方式错误 (第 42-44 行)
`preprocessFile` 需要 `ArrayBuffer`，但代码传入的是 `Buffer.buffer`（可能存在字节偏移问题）。

### 修复代码:

```typescript
// 第 42-44 行修复
// 修复前:
const buffer = Buffer.from(task.fileData!, "base64");
const workbook = await preprocessFile(buffer.buffer, task.fileType!, task.fileName);

// 修复后:
const buffer = Buffer.from(task.fileData!, "base64");
const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength
);
const workbook = await preprocessFile(arrayBuffer, task.fileType!, task.fileName);
```

```typescript
// 第 75 行修复
// 修复前:
const fieldMapping = task.fieldMappings as FieldMapping | null;

// 修复后:
const fieldMapping = task.fieldMapping as FieldMapping | null;
```

- [ ] **Step 1: 应用修复**

```bash
# 使用 replace_in_file 直接修复两处
```

---

## Task 2: 创建进度轮询 API

**Files:**
- Create: `src/app/api/import-tasks/[id]/progress/route.ts`

此 API 供前端 SSE/polling 使用，返回任务和分片执行进度。

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks, importTaskShards } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;

    // 查询任务主体
    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, id));

    if (!task) {
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
    }

    // 查询分片进度
    const shards = await db
      .select()
      .from(importTaskShards)
      .where(eq(importTaskShards.taskId, id))
      .orderBy(importTaskShards.shardIndex);

    // 汇总统计
    const completed = shards.filter((s) => s.status === "completed").length;
    const failed = shards.filter((s) => s.status === "failed").length;
    const total = shards.length;

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        progress: total > 0 ? Math.round((completed / total) * 100) : 0,
        totalRows: task.totalRows || 0,
        parsedRows: task.parsedRows || 0,
        shards: {
          total,
          completed,
          failed,
          processing: total - completed - failed,
        },
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 1: 创建文件并写入代码**

---

## Task 3: 创建结果获取 API

**Files:**
- Create: `src/app/api/import-tasks/[id]/result/route.ts`

解析完成后返回订单数据。

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { importTasks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;

    const [task] = await db
      .select()
      .from(importTasks)
      .where(eq(importTasks.id, id));

    if (!task) {
      return NextResponse.json({ success: false, error: "任务不存在" }, { status: 404 });
    }

    if (task.status === "processing") {
      return NextResponse.json({
        success: false,
        error: "任务尚未完成",
        status: task.status,
      }, { status: 202 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        totalRows: task.totalRows || 0,
        parsedRows: task.parsedRows || 0,
        error: task.error,
        result: task.status === "completed" ? task.result || {} : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 1: 创建文件并写入代码**

---

## Task 4: 创建进度监控页面

**Files:**
- Create: `src/app/import/[id]/progress/page.tsx`

按需求文档设计，包含进度条、分片状态、错误列表等。

核心功能：
1. 2s 轮询 `GET /api/import-tasks/[id]/progress`
2. 显示进度百分比、分片状态、预估剩余时间
3. 完成后显示结果摘要或自动跳转
4. 失败时显示错误详情

- [ ] **Step 1: 创建文件并写入代码**（使用 Ant Design Progress、Card、Alert 等组件）

---

## Task 5: 连接 V2 导入页到 V4 异步流程

**Files:**
- Modify: `src/app/import/page.tsx`

当前 V2 `handleStartParse` 使用 SSE 同步解析。需要改为调用 `POST /api/import-tasks` 创建异步任务，然后重定向到进度页。

关键改动：
1. `handleStartParse` 不再调用 SSE parse，改为 POST 文件+规则到 `/api/import-tasks`
2. 成功后 `router.push(/import/${taskId}/progress)`
3. 保留原有 rules/tasks 选择 UI

- [ ] **Step 1: 修改 `handleStartParse` 函数**

---

## Task 6: 修复 import-tasks POST 路由 — 连接队列

**Files:**
- Modify: `src/app/api/import-tasks/route.ts`

当前 POST 只写入 `event_outbox`，但没有将任务放入 BullMQ 队列。Outbox 调度器在 worker script 中作为独立进程运行，但当前 worker 脚本只启动了 `runWorker()`，没有启动 outbox 调度器。

**方案 A（推荐）**: POST 中直接入队 + 写入 outbox（确保事务一致性）
**方案 B**: Worker 脚本中同时启动 outbox 调度器

选择方案 A，因为更简单可靠：

```typescript
// 在 POST handler 中，创建任务+分片+outbox 事件后，直接入队
const { addShardJobs } = await import("@/lib/queue");
await addShardJobs(
  task.id,
  shards.map((s) => ({ shardId: s.id, shardIndex: s.shardIndex, traceId }))
);
```

- [ ] **Step 1: 修改 POST handler 添加入队调用**

---

## Task 7: 更新 Worker 脚本 — 启动 outbox 调度器

**Files:**
- Modify: `scripts/worker.ts`

Worker 启动时同时启动 outbox 调度器，确保后续 outbox 事件能被及时处理。

- [ ] **Step 1: 在 worker.ts 中启动调度器**

---

## Task 8: 完善 import-tasks GET 路由

**Files:**
- Modify: `src/app/api/import-tasks/route.ts`

GET 列出任务时增加分页、筛选（按状态、时间范围）。

- [ ] **Step 1: 添加分页和筛选参数**

---

## Task 9: 编译验证

**Files:**
- All modified/created files

- [ ] **Step 1: TypeScript 编译检查**
```bash
cd /Users/siguiyang/ztocc/ai-import && npx tsc --noEmit
```

- [ ] **Step 2: Lint 检查**

---

## 数据库映射关系总结

| 需求文档概念 | 数据库表 | 说明 |
|-------------|---------|------|
| 导入任务 | `import_tasks` | 一次导入请求对应一条记录，status 流转: pending→processing→completed/failed |
| 任务分片 | `import_task_shards` | 按行数拆分（默认 500 行/片），并行处理 |
| 任务错误 | `import_task_errors` | 按行记录错误（error_row, error_message, error_category） |
| 事件发件箱 | `event_outbox` | 可靠事件投递（与任务在同一事务中写入） |
| 性能日志 | `batch_performance_log` | 每次批处理的耗时、行数、错误数 |
| 追踪事件 | `trace_events` | 分布式追踪，记录 pipeline 各阶段耗时 |
| SKU 主数据 | `sku_master` | 降级查询缓存（SKU 校验失败时回退） |

# V4 异步事件驱动架构设计

## 整体流程

```
User Upload
    │
    ▼
┌────────────────────┐
│  POST /api/        │  ≤1s 返回 task_id
│  import-tasks      │
│  - 解析文件行数    │
│  - 创建 import_tasks│
│  - 创建 shards     │
│  - 创建 outbox     │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Outbox Dispatcher │  定时轮询 pending 事件
│  - 读取 outbox     │
│  - 投递到 BullMQ   │
│  - 标记为 sent     │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Upstash Redis     │  BullMQ Queue
│  import-shards     │
└────────┬───────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Worker × 2 (concurrent)               │
│  ┌──────────────────────────────────┐  │
│  │  processShardJob()               │  │
│  │  1. 读取文件 + 解析规则          │  │
│  │  2. 解析 → ParsedOrder[]        │  │
│  │  3. 提取分片行 [start, end]     │  │
│  │  4. 批量 SKU 校验               │  │
│  │     ├── 成功: 写入 orders       │  │
│  │     ├── SKU不存在: 写 errors    │  │
│  │     └── 超时≥3s: 降级          │  │
│  │  5. 批量 INSERT                 │  │
│  │  6. 写性能日志 + Trace          │  │
│  │  7. 更新进度                    │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────┐
│  Neon PostgreSQL   │
│  import_tasks      │ ← 进度查询
│  orders/orderItems │ ← 最终数据
│  importTaskErrors  │ ← 错误明细
│  perf/trace        │ ← 监控数据
└────────────────────┘
         │
         ▼
┌────────────────────┐
│  Monitor Dashboard │ 5s 轮询
│  - 吞吐量          │
│  - 队列深度        │
│  - 阶段耗时分布    │
│  - 错误类型统计    │
└────────────────────┘
```

## 数据库表结构

### sku_master — SKU 主数据
```
id (uuid PK)
sku_code (varchar UNIQUE)
name (varchar)
spec (varchar)
unit (varchar)
created_at
```

### import_tasks — 导入任务
```
id (uuid PK)
file_name, file_type, file_data (text/base64)
rule_id (uuid FK → parsing_rules)
status (enum: pending|processing|completed|failed|degraded)
total_rows, processed_rows, success_rows, failed_rows
total_shards, completed_shards
trace_id (varchar)
degraded (boolean)
error_message, created_at, updated_at, started_at, completed_at
```

### import_task_shards — 处理单元
```
id (uuid PK)
task_id (uuid FK)
shard_index (int)
start_row, end_row (int)
status (enum: pending|locked|completed|failed|skipped)
retry_count, locked_at, completed_at, created_at
```

### import_task_errors — 行级错误
```
id (uuid PK)
task_id, shard_index, row_number
field_name, raw_value, error_code, error_reason
trace_id, created_at
```

### event_outbox — 本地可靠事件
```
id (uuid PK)
aggregate_id (task_id)
event_type (IMPORT_SHARD_CREATED)
payload (jsonb: {taskId, shardIndex, startRow, endRow, traceId})
status (enum: pending|sent|failed)
retry_count, next_retry_at, created_at, sent_at
```

### batch_performance_log — 批次性能
```
id (uuid PK)
task_id, shard_index
parse_duration_ms, rule_duration_ms
validate_duration_ms, insert_duration_ms
total_duration_ms
status, row_count
trace_id, created_at
```

### trace_events — 链路事件
```
id (uuid PK)
trace_id, task_id, shard_index
event_name, event_status, message
metadata (jsonb)
occurred_at
```

## 容量推导

```
解析:    ~5ms/行 → 5s/1000行
规则:    ~3ms/行 → 3s/1000行
校验:    batch IN query ~100ms/1000行 → <1s
写入:    createMany ~500ms/1000行 → <1s
────────────────────────────────
每批:    ~10s
2 Workers × 10 分片 = 5 轮 × 10s = 50s < 60s ✓
```

10,000 单/分钟 × 60 分钟 = 600,000 单/小时满足量级要求。

## 容灾降级设计

```
SKU 校验                      │  策略
──────────────────────────────┼─────────────────
正常 (≤3s)                    │  正常校验
超时 (≥3s)                    │  降级 (格式校验)
sku_master 表异常              │  降级
降级后                        │  仅做格式校验
                              │  import_tasks.degraded = true
                              │  不可逆
```

## 监控指标体系

| 指标 | 数据源 | 刷新频率 |
|------|--------|---------|
| 吞吐量 | batch_performance_log | 5s |
| 队列积压 | BullMQ API | 5s |
| 阶段耗时 | batch_performance_log | 5s |
| 错误分布 | import_task_errors | 5s |
| 任务状态 | import_tasks | 5s |
| Trace 事件 | trace_events | 按需 |

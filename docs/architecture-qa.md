# 架构深度问答

## 1. 为什么 V2 下单导入链路不能继续采用同步阻塞方式？什么时候同步反而更简单可靠？

### 为什么不能同步

看当前项目的实际数据流，`POST /api/import-tasks` 上传文件后创建分片入队，Worker 异步处理每个分片。核心原因是：

- **文件行数不可控**：当前分片大小 1000 行/片，一个 10000 行的文件就是 10 个分片。如果同步处理，HTTP 请求会超时（Next.js 默认 60s 无服务器函数超时）
- **SKU 校验是外部调用**：`import-processor.ts` 中校验需要查 `sku_master` 表（可能还有外部 API），超时 3s 就触发降级。同步链路下任何一个分片卡住就会阻塞整个请求

### 同步更简单可靠的场景

- 小文件（< 200 行），处理时间 < 5s，同步一次写入无需队列、Outbox、Worker 等复杂基础设施
- 无外部依赖的纯解析场景（不做 SKU 校验），直接用同步即可

实际上当前项目在 `POST` 阶段已经做了**同步快计数**（`XLSX.read` + `sheet_to_json` 统计行数），这是正确的——不需要异步也能 1s 内完成。

---

## 2. 处理单元变大或变小，会分别带来什么影响？

当前项目分片大小 `SHARD_SIZE = 1000`：

| 维度 | 变大（如 5000 行/片） | 变小（如 200 行/片） |
|------|----------------------|---------------------|
| **数据库事务** | 单事务写入 5000 条 orders + 5000+ 条 items，长事务可能锁表、连接池耗尽 | 事务轻量，写入快 |
| **失败影响面** | 一个分片失败 = 5000 行全部回滚重试，重试成本高 | 仅回滚 200 行，影响范围可控 |
| **队列/Worker 开销** | 分片少，队列消息少，调度开销低 | 分片多，队列消息膨胀，BullMQ 和 Outbox 压力增大 |
| **并行度** | 10000 行 = 2 个分片，最多 2 个 Worker 并行（当前并发度 2），并行度受限于分片数 | 10000 行 = 50 个分片，可充分利用并行 |
| **进度反馈** | 颗粒度粗，用户看到的进度跳跃大 | 颗粒度细，进度更新平滑 |
| **内存** | Base64 解码 + 解析整个文件在内存中，大分片内存压力大 | 同样全量解码（当前实现是整体解码后切片），内存差异不明显 |

**结论**：当前 1000 行是合理的折中。如果行数据结构复杂（嵌套 SKU 多），可考虑降到 500。

---

## 3. 如果吞吐目标从 10,000 单/分钟提升到 50,000 单/分钟，最先成为瓶颈的是 Worker、Redis 队列还是数据库写入？你会如何扩展？

### 瓶颈分析

**最先成为瓶颈的是数据库写入**，原因：

1. **当前处理流程**：每个分片的事务包含 `INSERT INTO orders` + `INSERT INTO order_items` + `UPDATE import_task_shards` + `UPDATE import_tasks` + `INSERT INTO batch_performance_log` + `INSERT INTO import_task_errors`。50,000 单/分钟 ≈ 833 单/秒，每个分片 1000 行约 50 个分片/分钟，但事务内行数可能是 1000 × (1 + N_SKU) 条。
2. **Neon Serverless 的并发限制**：连接池有限，高并发写会产生 contention。
3. **Redis/BullMQ 反而不是瓶颈**：队列只是投递分片消息，50 分片/分钟远低于 Redis 的处理能力。

### 扩展方案

| 层级 | 措施 |
|------|------|
| **数据库** | 使用批量 `INSERT`（`pg-format` 或 `unnest`）替代逐行插入；拆分 orders 和 order_items 到不同连接；对 `orders` 表按 `task_id` 分区；考虑 Citus 水平分片 |
| **Worker** | 提高并发度从 2 → 8，水平扩容 Worker 实例；按 `shardIndex % N` 分到不同 Worker 组避免热点 |
| **写入优化** | 将 `batch_performance_log` 和 `trace_events` 改为异步批量写入（当前 trace 已经是 fire-and-forget）；合并多个分片的 `UPDATE import_tasks` 为批量增量更新 |

---

## 4. 如果队列消息重复投递，为什么"业务幂等"比"消息只投递一次"更重要？

当前项目实际采用的是 **At-Least-Once + 业务幂等** 策略：

- 直接入队到 BullMQ（同时保留 outbox 事件作为可靠性保障），同一个分片可能被投递两次（BullMQ 直接入队 + Outbox 补偿重投）。

### 消息只投递一次（Exactly-Once）不可靠的原因

- BullMQ 的 `removeOnComplete` 在处理成功后删除 job，但如果 Worker 崩溃在"处理完成但 ACK 丢失"时刻，消息会重新投递
- Outbox 分发器轮询 `event_outbox` 表，`sent` 标记和实际投递之间不是原子操作
- 网络分区、Redis 重启都可能导致重复投递

### 业务幂等的具体实现

- `import_task_shards` 表有唯一索引 `(taskId, shardIndex)`，重复处理同一个分片会命中已有记录
- 分片状态机：`pending → locked → completed`，Worker 获取分片时先 `UPDATE ... SET status='locked' WHERE status='pending'`，幂等保证只处理一次

**结论**：分布式系统中消息不重不丢是不可能的三角（CAP），接受重复投递 + 业务幂等是最务实的方案。

---

## 5. 如果某个处理单元中有部分行失败，你认为应该整体回滚还是成功行先入库？为什么？

当前项目采用的是**成功行先入库**策略：

- 每个分片事务中，校验失败的行记录到 `import_task_errors`，成功的行正常 `INSERT`
- 分片状态 `completed` + 错误数记录到 `failedRows`

### 成功行先入库的理由

1. **文件导入的特点**：10,000 行中 10 行字段格式错误，不应该因为这 10 行让 9,990 行全部作废
2. **用户期望**：导入完成后用户看到 "成功率 99.9%"，只需处理那 10 条错误，而不是重新上传
3. **当前项目的降级机制**：SKU 校验超时就降级跳过校验直接入库，说明业务优先级是"数据不丢" > "100% 验证"

### 整体回滚适用的场景

如果是财务对账类的强一致性场景（如银行转账），需要 ACID 全部成功。

---

## 6. 错误明细中需要保留原始值，但手机号和地址属于敏感信息，你如何平衡排障效率和数据安全？

当前 `import_task_errors` 表存储了 `rawValue`（原始值），但无脱敏。

### 建议平衡方案

| 层级 | 措施 |
|------|------|
| **存储层** | 对 `phone`、`address` 字段错误，存储脱敏值而非原始值（手机号中间 4 位 `****`，地址只保留省市） |
| **日志层** | `batch_performance_log` 不记录任何业务数据，仅记录耗时和行数 |
| **访问控制** | `import_task_errors` 的 `rawValue` 列单独权限控制，仅管理员可见完整信息 |
| **保留期** | 错误明细 7 天自动归档，`trace_events` 同样设置 TTL |
| **脱敏规则** | 在 `import-processor.ts` 的错误记录逻辑中增加一层 `maskSensitiveData()` 函数，按 `fieldName` 匹配脱敏策略 |

核心思路：**排障用 errorCode + errorReason 就够了**（如 `INVALID_PHONE` + "格式不符合要求"），只有极少数情况才需要看原始值，那时走权限审批。

---

## 7. 如果 Outbox 表持续增长到千万级，你会如何清理、归档和设计索引？

当前 `event_outbox` 表索引仅 `status` 和 `createdAt`。

### 清理策略

```
已完成（sent）事件 → 每天凌晨归档到 S3/对象存储 → 物理 DELETE
失败事件 → 保留 30 天 → 超过 30 天标记为 abandoned → DELETE
```

### 索引优化

```sql
-- 当前分发器查的是 pending 事件按时间排序，所以用复合索引
CREATE INDEX outbox_status_created_idx ON event_outbox(status, created_at)
  WHERE status = 'pending';

-- 清理时按 status + sent_at 批量删除
CREATE INDEX outbox_cleanup_idx ON event_outbox(sent_at)
  WHERE status = 'sent';
```

### 归档方案

- 每天 `INSERT INTO event_outbox_archive SELECT * FROM event_outbox WHERE sent_at < NOW() - INTERVAL '7 days' AND status = 'sent'`
- 归档表放在独立的廉价存储上（如 PostgreSQL 外部表到 S3）
- `LIMIT 10000 + DELETE` 分批清理，避免长事务

---

## 8. 如果 AI 生成的解析规则导致大量字段映射错误，监控系统如何帮助快速发现是规则问题而不是数据库问题？

### 判断逻辑

| 现象 | 结论 |
|------|------|
| `FIELD_MAPPING_ERROR` 错误码大量出现，且高度集中在某个 `ruleId` | **规则问题** |
| `SKU_NOT_FOUND` 错误大量出现，但 `sku_master` 表正常 | 规则映射的 SKU 字段不对 |
| `UNKNOWN_ERROR` 或 `DB_CONNECTION_ERROR` 出现，且错误分布均匀不挑规则 | **数据库问题** |
| 吞吐量突然跌到接近 0，Queue 积压飙升，但错误率正常 | 数据库慢查询/死锁 |

### 监控增强建议

在 `trace_events` 中增加 `ruleId` 字段，使得通过 trace 可以直接关联到具体规则：

```sql
-- 快速诊断查询
SELECT
  rule_id,
  error_code,
  COUNT(*) as cnt
FROM import_task_errors e
JOIN import_tasks t ON t.id = e.task_id
WHERE e.created_at > NOW() - INTERVAL '1 hour'
  AND error_code = 'FIELD_MAPPING_ERROR'
GROUP BY rule_id, error_code
ORDER BY cnt DESC
LIMIT 5;
```

### 最佳实践

- 规则发布前做**烟雾测试**（用 10 行样本文件跑一次，自动检查成功率 > 90%）
- 在 `errorReason` 中区分：`"字段映射失败：expected '收件人电话' but got '收货地址'"` vs `"数据库写入超时"`
- 监控看板增加「按规则分组的错误率」图表，一旦某个规则的错误率突增就触发告警

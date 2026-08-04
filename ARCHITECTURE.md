# V2 下单流程异步事件驱动重构 — 重构假设说明

## 1. 为什么选择异步事件驱动

V2 原有同步阻塞链路在每次上传时，于单次 HTTP 请求中完成「解析 → 规则 → 校验 → 写入」全部流程。该模式在小文件（< 100 行）场景下可用，但在大促或批量导入时存在致命缺陷：

- **Vercel Serverless 请求超时**：10,000 行数据同步处理超过 30 分钟，远超 Vercel 函数限制
- **数据库连接池打满**：多用户并发逐行 INSERT 瞬间耗尽连接池
- **前端无进度感知**：用户只能看 loading，反复点击触发重复上传
- **失败定位困难**：日志仅显示 `insert failed`，无法定位到行号、字段和原因

异步事件驱动将「上传与返回」和「数据处理」解耦：
- 上传后快速返回 `task_id`（P95 ≤ 1s）
- 文件解析、规则执行、校验、写入由后台 Worker 异步处理
- 通过 Outbox 模式保证任务创建和消息投递的可靠性
- 用户通过轮询或 SSE 实时获取进度

### 1.1 文件去重策略

- **哈希算法**：SHA-256（碰撞概率 < 10⁻⁶⁰）
- **去重窗口**：24h，窗口内相同哈希的文件视为重复，直接返回已有 `task_id`
- **存储列**：`import_tasks.content_hash`
- **前端行为**：去重命中后跳转到已有任务的进度页，无需重新创建
- **降级策略**：去重查询失败不阻塞上传流
- **设计理由**：
  - 避免用户误操作重复上传浪费计算资源
  - 24h 窗口覆盖重试场景、避免分段测试误拦
  - 不限文件类型，exact-content 匹配最严谨

### 1.2 上传防重复点击

- `useRef` 存储选中文件引用
- `uploading` 状态锁 + Button `disabled` 双保险
- Dragger `beforeUpload={false}` 阻止组件默认行为
- 点击后 `message.success` + `router.push` 跳转任务进度页

## 2. 处理单元设计

- **处理单元大小**：1000 行/批。选取理由：
  - 每个批次在 Vercel Serverless 函数（60s 时限）内可完成
  - 1000 行的解析+规则+校验+写入通常在 3-8 秒内完成
  - 失败成本可控：单批次失败仅影响 1000 行，其余批次不受影响
- **10,000 行 = 10 个批次**，理论上 10 个批次并发处理可在 10-20 秒内完成

## 3. Worker 容量规划

- **Worker 模式**：上传完成后 fire-and-forget 触发 Dispatcher（不依赖 Cron）
- **并发控制**：每次 Dispatcher 调用最多处理 5 个批次（MAX_EVENTS_PER_RUN = 5）
- **10,000 行推导**：
  - 10 个批次 × 平均 5s/批次 = 50s 总处理时间
  - 单次 Dispatcher 处理 5 个，分 2 轮触发即可完成
  - 满足 10,000 单/分钟的目标
- **Vercel Hobby 兼容**：不依赖 sub-daily cron，Dispatcher 由上传 API 的 fire-and-forget fetch 触发
- **Pro 计划升级路径**：可添加 `0 0 * * *` 兜底 cron，每日清理超时任务和积压事件

## 4. 10,000 单/分钟性能推导

| 指标 | 数值 | 说明 |
|------|------|------|
| 文件行数 | 10,000 行 | 压测文件 |
| 批次大小 | 1,000 行 | 10 个批次 |
| 批次处理耗时 | 3-8 秒 | 包含解析+规则+校验+写入 |
| 分发触发 | 上传时即时 | 上传 API fire-and-forget 触发 Dispatch |
| 总耗时预估 | 20-40 秒 | ≤ 60s 目标 |
| 上传响应 P95 | ≤ 1 秒 | 仅创建任务+存储原始数据 |

## 5. 数据库连接池控制

- 使用 `@neondatabase/serverless` 的 neon 驱动，连接池由 Neon 管理
- 批量校验：使用 `ANY(${skuCodes})` 批量查询 SKU 主数据
- 批量写入：使用 `INSERT ... VALUES ... ON CONFLICT DO NOTHING` 批量 UPSERT
- 每次 Dispatcher 并发处理 ≤ 5 个批次，峰值连接数 ≤ 5

## 6. Outbox 可靠性保证

### 6.1 事务原子性

任务创建（`import_tasks`）与 Outbox 事件（`event_outbox`）、处理单元状态（`import_task_batches`）、原始数据（`import_task_raw_data`）全部在**同一个数据库事务**中写入。

- 使用 Neon serverless `sql.transaction()` 将多个 INSERT 作为单个批处理发送
- 任一步骤失败 → 自动 ROLLBACK → 数据库无残留数据
- 避免了「任务已创建但消息未投递」的不一致状态

### 6.2 Outbox 事件生命周期

```
PENDING → SENT → SUCCEEDED    (成功路径)
  ↑        ↓
  └────────┘                   (失败重试：SENT 超时回收到 PENDING)
           ↘ FAILED            (永久失败：超过 3 次重试)
```

| 状态 | 含义 | 转移条件 |
|------|------|----------|
| `PENDING` | 待投递 | 初始状态 / 重试等待 |
| `SENT` | 已分发给 Worker，处理中 | Dispatcher 标记 |
| `SUCCEEDED` | Worker 执行成功 | 批次完成 |
| `FAILED` | 永久失败 | 重试次数 ≥ 3 |

### 6.3 崩溃恢复（SENT 超时回收）

**问题**：Dispatcher 标记 SENT 后进程崩溃，Worker 未执行或未完成，事件永远卡在 SENT。

**机制**（每次 Dispatcher 调用前执行）：
```sql
-- 回收条件：SENT + 超过 60 秒 + 对应 batch 未 SUCCEEDED/FAILED
UPDATE event_outbox
SET status = 'PENDING', next_retry_at = NOW()
WHERE id IN (
  SELECT eo.id FROM event_outbox eo
  LEFT JOIN import_task_batches itb ON ...
  WHERE eo.status = 'SENT'
    AND eo.sent_at < NOW() - INTERVAL '60 seconds'
    AND itb.status NOT IN ('SUCCEEDED', 'FAILED')
)
```

### 6.4 失败重试策略

- **最大重试次数**：3 次（`MAX_OUTBOX_RETRIES = 3`）
- **退避策略**：递增延迟：30s → 60s → 90s
- **超限处理**：标记 `FAILED`，设置 5 分钟后再检查（`next_retry_at`）
- **重试安全**：Worker 幂等保护（检查 batch 是否已完成 + Redis 重试上限 + 乐观锁）

### 6.5 幂等处理（Worker 端）

同一处理单元事件被重复投递时，Worker 通过三层保护确保幂等：
1. **DB 层**：`checkBatchCompleted()` 检查 `import_task_batches.status` 是否已 SUCCEEDED/FAILED
2. **Redis 层**：`incrementRetryCount()` 原子检查重试上限（> 3 直接返回）
3. **锁层**：`lockBatch()` 使用 `WHERE status = 'QUEUED'` 条件更新，多 Worker 只允许一个获得锁

### 6.6 禁止的模式

- ❌ 直接调用 `queue.add()` 而不经过 `event_outbox`
- ❌ 在上传 API 中同步执行导入逻辑
- ❌ Outbox 标记 SENT 后不处理 SUCCEEDED/FAILED 终结态

## 7. Worker 异步处理流程（模块四）

### 7.1 处理流程

Worker 消费单个处理单元 Job 时，按以下步骤执行：

```
Step 1: 读取原始数据
  SELECT FROM import_task_raw_data WHERE row_index BETWEEN startRow AND endRow

Step 2: V2 规则映射
  applyRules(rawRows, rule) → mappedRows
  - columnMappings 字段映射（column / value / row 三种源类型）
  - 类型转换（string / number / integer / date / boolean）
  - 默认值填充
  - 跨行聚合（groupBy → 按字段分组 → 合并 SKU 数量和编码）

Step 3: SKU 主数据批量查询
  SELECT FROM sku_master WHERE sku_code = ANY(...)
  → 补充 sku_name、sku_spec 等缺失字段

Step 4: 校验
  - E002 必填字段缺失
  - E003 电话格式错误（正则匹配大陆手机号/固话）
  - E004 数量非正数（≤ 0 报错）
  - E005 批内外部编码重复（seenCodes 去重）

Step 5: 分离成功/失败行

Step 6: 写入失败详情
  INSERT INTO import_task_errors (id, task_id, unit_id, batch_index,
    row_number, field_name, raw_value, error_code, error_reason)

Step 7: 批量 UPSERT 运单表
  INSERT INTO orders (...) VALUES (...)
  ON CONFLICT (external_code) WHERE external_code IS NOT NULL
  DO UPDATE SET ... (真正的幂等 UPSERT)

Step 8: 写入性能日志
  INSERT INTO batch_performance_log (parse_duration_ms, rule_duration_ms,
    validate_duration_ms, insert_duration_ms, total_duration_ms)

Step 9: 原子更新任务计数
  UPDATE import_tasks SET
    processed_rows = processed_rows + N,
    success_rows = success_rows + N,
    failed_rows = failed_rows + N,
    completed_batches = completed_batches + 1

Step 10: 任务状态检查
  所有批次完成 → 检查结果 → 更新最终状态
```

### 7.2 任务状态转移规则

| 场景 | 任务状态 |
|------|----------|
| 全部行成功 | `COMPLETED` |
| 部分行失败，成功行已入库 | `PARTIAL_SUCCESS` |
| 全部处理单元失败或系统级错误不可恢复 | `FAILED` |
| 仍有处理单元运行中 | `PROCESSING` |
| 等待队列处理 | `PENDING` |

状态转移：
```
PENDING → PROCESSING (首个批次开始)
PROCESSING → COMPLETED (全部成功)
PROCESSING → PARTIAL_SUCCESS (部分失败)
PROCESSING → FAILED (全部批次失败)
```

### 7.3 类型转换

支持 `TypeConversion[]` 配置在 `ParseRule` 中：

| targetType | 处理方式 |
|-----------|----------|
| `number` | parseFloat，移除千分分隔符 |
| `integer` | parseInt |
| `date` | ISO 8601 → 中文日期 → `yyyy-MM-dd` → 时间戳 |
| `boolean` | true/1/是/yes → true |
| `string` | 清 trim |

### 7.4 跨行聚合

当 `ParseRule.groupBy` 指定分组字段时：
- 将所有映射后行按 `groupBy` 字段分组
- 合并 SKU 数量字段（sum）
- 合并 SKU 编码/名称（逗号拼接）
- 标记 `_aggregated_from = N` 表示聚合行数

### 7.5 运单 UPSERT

- `orders.external_code` 上建立唯一部分索引（`WHERE external_code IS NOT NULL`）
- `ON CONFLICT (external_code)` 实现真正 UPSERT：重复外部编码 → UPDATE 而非 INSERT
- NULL external_code 不触发冲突（允许多个 NULL）

### 7.6 幂等处理（Worker 端）

同一处理单元事件被重复投递时，Worker 三层保护确保幂等：
1. **DB 层**：`checkBatchCompleted()` 检查 `import_task_batches.status` 是否已 SUCCEEDED/FAILED
2. **Redis 层**：`checkRetryLimit()` 原子检查重试上限（MAX_RETRIES = 3）
3. **锁层**：`lockBatch()` Redis 乐观锁，仅 QUEUED 状态可进入 PROCESSING

### 7.7 禁止的模式

- ❌ 为压测文件写死字段映射
- ❌ 上传接口中同步执行导入逻辑
- ❌ `ON CONFLICT DO NOTHING` 替代真 UPSERT
- ❌ 手动递增计数（应用层累加），必须用 SQL `+ N` 原子操作

## 8. 处理单元幂等与重复处理保护（模块五）

### 8.1 核心设计

模块五在模块三（Outbox）和模块四（Worker）基础上，进一步增强幂等性：

```
                   ┌──────────────────────────────────────┐
                   │ Dispatcher 投递                          │
                   │ UPDATE PENDING → QUEUED                  │
                   └──────────────┬───────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ 入口 CAS：acquireBatch()                 │
                   │ UPDATE QUEUED → PROCESSING               │
                   │ WHERE version = ?                        │
                   │ → 只有一个 Worker 拿到处理权              │
                   └──────────────┬───────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ Worker 处理                              │
                   │ applyRules → validate → UPSERT          │
                   └──────────────┬───────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────────────┐
                   │ 完成 CAS：completeBatchCAS()             │
                   │ UPDATE PROCESSING → SUCCEEDED/FAILED     │
                   │ → 仅 CAS 赢家调用 updateTaskProgress     │
                   │ → 进度计数 100% 幂等                      │
                   └──────────────────────────────────────┘
```

### 8.2 四层幂等保护

| 层级 | 机制 | 保护目标 |
|------|------|----------|
| **L1 DB 入口** | `checkBatchCompleted()` 查询 `import_task_batches.status` → SUCCEEDED/FAILED 快速返回 | 已完成单元不再处理 |
| **L2 DB CAS 获取权** | `acquireBatch()` atomically UPDATE QUEUED→PROCESSING | 多 Worker 并发时只有一个获胜 |
| **L3 DB CAS 完成** | `completeBatchCAS()` atomically UPDATE PROCESSING→SUCCEEDED/FAILED | 进度累计只在 CAS 成功后执行 |
| **L4 UPSERT 幂等** | `ON CONFLICT (external_code, sku_code, line_no)` | 重复写入不产生重复记录 |

### 8.3 复合业务键 UPSERT

**之前**：`ON CONFLICT (external_code)` — 单列唯一键
- 问题：同一外部单号有多个 SKU 时，第二个 SKU 的行会被丢弃

**现在**：`ON CONFLICT (external_code, sku_code, line_no)` — 三元组唯一键
- `external_code`：外部运单号
- `sku_code`：SKU 编码
- `line_no`：行号（从 Excel 行号推导，1-based）

```sql
CREATE UNIQUE INDEX uq_orders_business_key
ON orders (external_code, sku_code, line_no)
WHERE external_code IS NOT NULL;

INSERT INTO orders (...) VALUES (...)
ON CONFLICT (external_code, sku_code, line_no)
  WHERE external_code IS NOT NULL
DO UPDATE SET ...;
```

### 8.4 版本号乐观锁

`import_task_batches.version` 在每次状态变更时自增：

```
PENDING (version=0) → QUEUED (version=0) → PROCESSING (version=1, CAS)
  → SUCCEEDED (version=2, CAS)
  → FAILED (version=2, CAS)
```

CAS 使用 `WHERE status = ? AND version = ?` 确保一致性。

### 8.5 进度计数幂等

**关键保证**：`updateTaskProgress()` 仅在 `completeBatchCAS()` 返回 true 后调用。

- `completeBatchCAS` 使用 `WHERE status = 'PROCESSING'` 条件更新
- 只有唯一 Worker 能将批次从 PROCESSING 翻转为 SUCCEEDED/FAILED
- 获取 CAS 成功后，该 Worker 独占进度累计权
- 重复投递的 Job 在 L1（入口检查）或 L2（获取权 CAS）被拦截

### 8.6 快速返回已完成

```
checkBatchCompleted(taskId, unitId)
  ├── Redis: getBatchState → SUCCEEDED/FAILED → return true
  └── DB 回退: SELECT status FROM import_task_batches → return
```

已完成处理单元在 0.5ms 内返回，不执行任何业务逻辑。

### 8.7 防止重复累计对照

| 场景 | 保护机制 |
|------|----------|
| 同一批次被多次投递 | L1: `checkBatchCompleted` 查询 DB 状态 |
| 多个 Worker 同时处理同一批次 | L2: `acquireBatch` CAS QUEUED→PROCESSING |
| Worker 处理成功后重试消息仍抵达 | L1: batch status 已是 SUCCEEDED |
| Worker 崩溃后重试 | L2: 新 Worker CAS 成功 → 继续处理 |
| 进度二次累计 | L3: 仅在 CAS 成功后调用 updateTaskProgress |
| 相同业务键重复插入 | L4: ON CONFLICT DO UPDATE |

## 9. 幂等设计（旧版参考）

允许部分行失败、成功行继续入库：
- 失败行写入 `import_task_errors` 表，记录批次号、行号、字段、错误码、原始值
- 成功行批量写入运单表
- 任务最终状态根据 `failed_rows` 决定：0 则为 `COMPLETED`，> 0 则为 `PARTIAL_SUCCESS`

理由：批量导入场景下，少量行失败不应阻塞大量成功数据入库。如需回滚，可由运维根据错误明细人工处理。

## 10. 精细化错误记录（模块六）

### 10.1 错误明细表

`import_task_errors` 定义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | `${taskId}_${unitId}_${rowNumber}_${errorCode}_${fieldName}` |
| `task_id` | TEXT NOT NULL | 所属导入任务 |
| `unit_id` | TEXT NOT NULL | 处理单元 ID |
| `batch_index` | INTEGER NOT NULL | 处理批次号（第几批） |
| `row_number` | INTEGER NOT NULL | 文件全局行号 |
| `field_name` | TEXT NOT NULL | 出错字段名 |
| `raw_value` | TEXT | 原始值（未脱敏，最多 500 字符） |
| `raw_value_masked` | TEXT | 脱敏后值 |
| `error_code` | TEXT NOT NULL | 错误码 E001-E008, SYS001 |
| `error_reason` | TEXT NOT NULL | 可读错误原因 |
| `suggested_fix` | TEXT | 修复建议 |
| `trace_id` | TEXT NOT NULL | 链路追踪 ID |
| `created_at` | TIMESTAMP | 记录时间 |

### 10.2 错误码体系

| 错误码 | 含义 | 触发位置 | 建议修复 |
|--------|------|----------|----------|
| `E001` | SKU 不存在 | `enrichSkuMaster()` 查询 `sku_master` 未命中 | 创建该 SKU 后再导入 |
| `E002` | 必填字段缺失 | `batchValidate()` 检查 6 个必填字段 | 补充缺失字段值后重新导入 |
| `E003` | 电话格式错误 | `batchValidate()` 正则匹配手机/固话格式 | 修正为有效电话号码 |
| `E004` | 数量不是正数 | `batchValidate()` 检查数量 ≤ 0 或 NaN | 修改为正整数（≥ 1） |
| `E005` | 外部编码批内重复 | `batchValidate()` `seenCodes` 去重 | 为每组 SKU 使用不同行 |
| `E006` | 规则映射失败 | `applyRules()` 类型转换/字段映射异常 | 检查映射规则字段名和类型 |
| `E007` | 数据库写入失败 | Worker catch 块中检测 DB 异常关键词 | 稍后重试或联系技术支持 |
| `E008` | 文件格式不支持 | `parseFileFromBuffer()` 不在 xlsx/xls/docx | 使用支持的格式 |
| `SYS001` | 系统异常 | Worker catch 中非 DB 异常 | 联系技术支持查看 Trace ID |

### 10.3 敏感字段脱敏

在写入 `import_task_errors` 时，`SENSITIVE_FIELDS` 中的字段自动脱敏：

- **手机号**：`13812345678` → `138****5678`
- **短文本**（≤ 3 字符）：完全替换为 `***`
- **其他**：`张三` → `张***三`
- **非敏感字段**：不脱敏，原样保留

敏感字段集：`receiver_phone`, `receiver_name`, `email`, `id_card`, `bank_account`, `receiver_address`, `address`

### 10.4 错误采集点

```
Worker 处理流程：
│
├── Step 2: applyRules()        → E006 (映射失败)
├── Step 3: enrichSkuMaster()   → E001 (SKU 不存在)
├── Step 4: batchValidate()     → E002 (必填), E003 (电话), E004 (数量), E005 (重复)
├── Step 6: recordBatchErrors() → 统一写入，含脱敏 + 修复建议
└── catch 块                    → E007 (DB 异常) / SYS001 (系统异常)

上传 API：
└── parseFileFromBuffer()       → E008 (文件格式不支持)
```

### 10.5 前端错误展示

**列表页**：
- 按批次筛选（批次下拉框）
- 按错误类型筛选（错误码下拉框）
- 分页加载（20 条/页）
- 修复建议列（`BulbOutlined` 图标 + 文本）

**详情弹窗**（点击行/眼睛图标）：
- 完整原始值（可复制、可展开长文本、脱敏显示）
- 错误码 + 错误类型
- 错误原因（红色高亮）
- 修复建议（黄色高亮，`BulbOutlined` 图标）
- Trace ID（等宽字体，可复制）
- 记录时间

**禁止项**：
- ❌ 只显示"导入失败，请重试"
- ❌ 不区分错误码
- ❌ 不提供原始值
- ❌ 不提供修复建议

## 11. SKU 校验降级

- **触发条件**：SKU 主数据查询超时（> 3s）或数据库连接失败
- **降级行为**：跳过 SKU 主数据校验，仅做本地格式校验
- **前端展示**：任务详情页显示 ⚠️ SKU 校验已降级 提示
- **恢复机制**：服务恢复后，新任务自动恢复正常校验
- **是否补校验**：未自动补校验。运维可导出降级任务的运单数据，手动对比主数据

## 10. 敏感数据脱敏

- 手机号存储时脱敏：`138****1234`（保留前 3 位 + 后 4 位）
- 地址不做脱敏（非标识性敏感信息）
- 错误明细中的 `raw_value` 对手机号字段做脱敏处理
- 脱敏在 `import-worker.ts` 的 `maskSensitive()` 函数中实现

## 12. 压测数据生成与清理

- `npm run seed` — 一键清理旧数据 + 灌入 20,000 条 SKU + 生成 10,000 行 Excel
- `npm run seed:clean` — 仅清理
- `npm run gen:test-file` — 仅生成压测 Excel
- 清理范围：`orders`（PERF- 前缀）、所有导入任务相关表、SKU 主数据（SKU_ 前缀）

## 13. 向产品经理/运维团队的建议问题

1. 10,000 单/分钟是否包含 AI 规则生成时间？（目前不计入）
2. 部分成功任务中的数据，是否需要提供一键回滚能力？
3. 降级任务中未校验的行，是否需要自动补校验？如果需要，触发时机是什么？
4. 错误日志和性能日志的保留周期？（目前无自动清理机制）
5. 是否需要支持 WebSocket/SSE 实时推送进度？当前使用轮询
6. 是否考虑升级到 Vercel Pro 以获得 sub-daily cron？当前使用上传触发分发（Hobby 兼容）

"use client";

import { useState } from "react";
import {
  Card,
  Input,
  Button,
  Tag,
  Typography,
  Timeline,
  Space,
  Descriptions,
  Select,
  Spin,
  Empty,
  Table,
} from "antd";
import {
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";

const { Title, Text } = Typography;

interface TraceResult {
  traceId: string;
  taskId?: string;
  task?: any;
  eventCount?: number;
  events: Array<{
    id: string;
    eventName: string;
    eventStatus: string;
    message: string | null;
    shardIndex: number | null;
    occurredAt: string;
    metadata: any;
  }>;
}

interface SearchResult {
  type: string;
  tasks: any[];
  errors: Array<{
    id: string;
    taskId: string;
    shardIndex: number | null;
    rowNumber: number;
    errorCode: string;
    errorReason: string;
    createdAt: string;
  }>;
  events: TraceResult["events"];
}

const statusIcon: Record<string, React.ReactNode> = {
  ok: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
  error: <CloseCircleOutlined style={{ color: "#ff4d4f" }} />,
  degraded: <WarningOutlined style={{ color: "#faad14" }} />,
  warning: <WarningOutlined style={{ color: "#faad14" }} />,
  pending: <ClockCircleOutlined style={{ color: "#1890ff" }} />,
};

const statusColor: Record<string, string> = {
  ok: "green",
  error: "red",
  degraded: "orange",
  warning: "orange",
  pending: "blue",
};

const SEARCH_TYPES = [
  { value: "trace", label: "按 Trace ID" },
  { value: "task", label: "按 Task ID" },
  { value: "fileName", label: "按文件名" },
  { value: "shard", label: "按批次号 (taskId:shardIndex)" },
  { value: "rowRange", label: "按行号范围 (start-end)" },
  { value: "errorCode", label: "按错误码" },
] as const;

type SearchType = (typeof SEARCH_TYPES)[number]["value"];

export default function TracesPage() {
  const [searchValue, setSearchValue] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("trace");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdvanced =
    searchType === "fileName" ||
    searchType === "shard" ||
    searchType === "rowRange" ||
    searchType === "errorCode";

  const placeholderMap: Record<SearchType, string> = {
    trace: "输入 Trace ID...",
    task: "输入 Task ID...",
    fileName: "输入文件名关键字，如 订单导入.xlsx",
    shard: "输入 taskId:shardIndex，如 1a2b...:2",
    rowRange: "输入行号范围，如 100-200",
    errorCode: "输入错误码，如 E001 / E007",
  };

  const handleSearch = async () => {
    if (!searchValue.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSearchResults(null);

    try {
      if (isAdvanced) {
        const res = await fetch(
          `/api/traces/search?type=${searchType}&q=${encodeURIComponent(searchValue.trim())}`
        );
        if (res.ok) {
          setSearchResults(await res.json());
        } else {
          const err = await res.json();
          setError(err.error || "搜索失败");
        }
      } else {
        const type = searchType === "task" ? "task" : "trace";
        const res = await fetch(
          `/api/traces/${encodeURIComponent(searchValue.trim())}?type=${type}`
        );
        if (res.ok) {
          setResult(await res.json());
        } else {
          const err = await res.json();
          setError(err.error || "查询失败");
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const viewTaskTrace = async (taskId: string) => {
    setLoading(true);
    setError(null);
    setSearchResults(null);
    try {
      const res = await fetch(`/api/traces/${encodeURIComponent(taskId)}?type=task`);
      if (res.ok) {
        setResult(await res.json());
      } else {
        const err = await res.json();
        setError(err.error || "查询失败");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const hasAdvancedResult = searchResults && (
    searchResults.tasks.length > 0 ||
    searchResults.errors.length > 0 ||
    searchResults.events.length > 0
  );

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        Trace 检索
      </Title>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            value={searchType}
            onChange={(v) => {
              setSearchType(v);
              setSearchValue("");
            }}
            options={SEARCH_TYPES.map((t) => ({ label: t.label, value: t.value }))}
            style={{ width: 260 }}
          />
          <Input
            placeholder={placeholderMap[searchType]}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 360 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={handleSearch}
            loading={loading}
          >
            搜索
          </Button>
        </Space>
      </Card>

      {loading && (
        <Spin size="large" style={{ display: "block", margin: "48px auto" }} />
      )}

      {error && (
        <Card>
          <Text type="danger">{error}</Text>
        </Card>
      )}

      {!loading && !error && !result && !hasAdvancedResult && (
        <Empty description="支持按 Trace ID / Task ID / 文件名 / 批次号 / 行号范围 / 错误码 检索" />
      )}

      {/* 高级搜索结果 */}
      {!loading && !error && searchResults && hasAdvancedResult && (
        <>
          {searchResults.tasks.length > 0 && (
            <Card title={`关联任务 (${searchResults.tasks.length} 个)`} style={{ marginBottom: 16 }}>
              <Table
                dataSource={searchResults.tasks}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
                onRow={(record) => ({
                  onClick: () => viewTaskTrace(record.id),
                  style: { cursor: "pointer" },
                })}
                columns={[
                  { title: "文件名", dataIndex: "fileName", ellipsis: true },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 110,
                    render: (v: string) => {
                      const map: Record<string, string> = {
                        pending: "待处理",
                        processing: "处理中",
                        completed: "已完成",
                        partial_success: "部分成功",
                        failed: "失败",
                        degraded: "降级完成",
                      };
                      return <Tag>{map[v] || v}</Tag>;
                    },
                  },
                  { title: "总行数", dataIndex: "totalRows", width: 90 },
                  { title: "成功", dataIndex: "successRows", width: 90 },
                  { title: "失败", dataIndex: "failedRows", width: 90 },
                  {
                    title: "Trace ID",
                    dataIndex: "traceId",
                    render: (v: string) => (
                      <Text copyable style={{ fontSize: 12 }}>{v || "-"}</Text>
                    ),
                  },
                ]}
              />
            </Card>
          )}

          {searchResults.errors.length > 0 && (
            <Card
              title={`行级错误明细 (${searchResults.errors.length} 条)`}
              style={{ marginBottom: 16 }}
            >
              <Table
                dataSource={searchResults.errors}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
                onRow={(record) => ({
                  onClick: () => viewTaskTrace(record.taskId),
                  style: { cursor: "pointer" },
                })}
                columns={[
                  { title: "行号", dataIndex: "rowNumber", width: 80 },
                  {
                    title: "批次",
                    dataIndex: "shardIndex",
                    width: 70,
                    render: (v: number | null) => (v === null || v === undefined ? "-" : `#${v}`),
                  },
                  {
                    title: "错误码",
                    dataIndex: "errorCode",
                    width: 120,
                    render: (v: string) => <Tag color="red">{v}</Tag>,
                  },
                  { title: "错误原因", dataIndex: "errorReason", ellipsis: true },
                  {
                    title: "时间",
                    dataIndex: "createdAt",
                    width: 170,
                    render: (v: string) => new Date(v).toLocaleString(),
                  },
                ]}
              />
            </Card>
          )}

          {searchResults.events.length > 0 && (
            <Card title={`批次事件时间线 (${searchResults.events.length} 条)`}>
              <Timeline
                items={searchResults.events.map((event) => ({
                  color: statusColor[event.eventStatus] || "gray",
                  dot: statusIcon[event.eventStatus],
                  children: (
                    <div key={event.id}>
                      <Space size={8}>
                        <Tag color={statusColor[event.eventStatus] || "default"}>
                          {event.eventName}
                        </Tag>
                        {event.shardIndex !== null && (
                          <Tag>Shard #{event.shardIndex}</Tag>
                        )}
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {new Date(event.occurredAt).toLocaleTimeString()}
                        </Text>
                      </Space>
                      {event.message && (
                        <div>
                          <Text style={{ fontSize: 13 }}>{event.message}</Text>
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            </Card>
          )}
        </>
      )}

      {/* Trace / Task 详情 */}
      {result && (
        <>
          {/* 任务信息 */}
          {result.task && (
            <Card title="关联任务" style={{ marginBottom: 16 }}>
              <Descriptions column={3} size="small">
                <Descriptions.Item label="Task ID">
                  <Text copyable>{result.task.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="文件名">
                  {result.task.fileName}
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag>
                    {{
                      pending: "待处理",
                      processing: "处理中",
                      completed: "已完成",
                      partial_success: "部分成功",
                      failed: "失败",
                      degraded: "降级完成",
                    }[result.task.status] || result.task.status}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="总行数">
                  {result.task.totalRows}
                </Descriptions.Item>
                <Descriptions.Item label="已完成">
                  {result.task.completedShards} / {result.task.totalShards}
                </Descriptions.Item>
                <Descriptions.Item label="降级">
                  {result.task.degraded ? (
                    <Tag color="warning">是</Tag>
                  ) : (
                    <Tag>否</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Trace ID">
                  <Text copyable style={{ fontSize: 12 }}>
                    {result.traceId}
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          )}

          {/* 事件时间线 */}
          <Card
            title={`事件时间线 (${result.events.length} 条)`}
            extra={
              <Button
                size="small"
                icon={<FileSearchOutlined />}
                onClick={() => setResult(null)}
              >
                返回搜索
              </Button>
            }
          >
            <Timeline
              items={result.events.map((event) => ({
                color: statusColor[event.eventStatus] || "gray",
                dot: statusIcon[event.eventStatus],
                children: (
                  <div key={event.id}>
                    <Space size={8}>
                      <Tag color={statusColor[event.eventStatus] || "default"}>
                        {event.eventName}
                      </Tag>
                      {event.shardIndex !== null && (
                        <Tag>Shard #{event.shardIndex}</Tag>
                      )}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(event.occurredAt).toLocaleTimeString()}.
                        {String(new Date(event.occurredAt).getMilliseconds()).padStart(3, "0")}
                      </Text>
                    </Space>
                    {event.message && (
                      <div>
                        <Text style={{ fontSize: 13 }}>{event.message}</Text>
                      </div>
                    )}
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {JSON.stringify(event.metadata, null, 0)
                            .replace(/[{""}]/g, "")
                            .replace(/,/g, ", ")}
                        </Text>
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}

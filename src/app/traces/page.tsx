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
} from "antd";
import {
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
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

const statusIcon: Record<string, React.ReactNode> = {
  ok: <CheckCircleOutlined style={{ color: "#52c41a" }} />,
  error: <CloseCircleOutlined style={{ color: "#ff4d4f" }} />,
  degraded: <WarningOutlined style={{ color: "#faad14" }} />,
  pending: <ClockCircleOutlined style={{ color: "#1890ff" }} />,
};

const statusColor: Record<string, string> = {
  ok: "green",
  error: "red",
  degraded: "orange",
  pending: "blue",
};

export default function TracesPage() {
  const [searchValue, setSearchValue] = useState("");
  const [searchType, setSearchType] = useState<"trace" | "task">("trace");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchValue.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const type = searchType === "task" ? "task" : "trace";
      const res = await fetch(
        `/api/traces/${encodeURIComponent(searchValue.trim())}?type=${type}`
      );
      if (res.ok) {
        setResult(await res.json());
      } else {
        const err = await res.json();
        setError(err.error || "Query failed");
        setResult(null);
      }
    } catch (e: any) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        Trace 检索
      </Title>

      {/* 搜索栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Select
            value={searchType}
            onChange={setSearchType}
            options={[
              { label: "按 Trace ID", value: "trace" },
              { label: "按 Task ID", value: "task" },
            ]}
            style={{ width: 140 }}
          />
          <Input
            placeholder={
              searchType === "trace"
                ? "输入 Trace ID..."
                : "输入 Task ID..."
            }
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 400 }}
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

      {/* 结果 */}
      {loading && <Spin size="large" style={{ display: "block", margin: "48px auto" }} />}

      {error && (
        <Card>
          <Text type="danger">{error}</Text>
        </Card>
      )}

      {!loading && !error && !result && (
        <Empty description="输入 Trace ID 或 Task ID 进行检索" />
      )}

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
                  <Tag>{result.task.status}</Tag>
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
              <Text type="secondary">
                {result.eventCount} events
              </Text>
            }
          >
            <Timeline
              items={result.events.map((event) => ({
                color: statusColor[event.eventStatus] || "gray",
                dot: statusIcon[event.eventStatus],
                children: (
                  <div key={event.id}>
                    <Space size={8}>
                      <Tag color={statusColor[event.eventStatus]}>
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

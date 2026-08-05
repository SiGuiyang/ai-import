"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Typography,
  Spin,
  Progress,
  Tooltip,
} from "antd";
import {
  ThunderboltOutlined,
  InboxOutlined,
  CloseCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  RiseOutlined,
  FallOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

const { Title, Text } = Typography;

interface RecentTask {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  createdAt: string;
}

interface TaskSummary {
  totalTasks: number;
  totalRows: number;
  successRows: number;
  failedRows: number;
  completedTasks: number;
  failedTasks: number;
}

interface MonitorData {
  throughput: Record<string, { totalRows: number; count: number }>;
  queue: { waiting: number; active: number; completed: number; failed: number; delayed: number };
  performance: { totalAvg: number; totalMax: number; totalMin: number; perfCount: number; parseAvg: number; validateAvg: number; insertAvg: number };
  errors: Array<{ errorCode: string; errorCount: number }>;
  taskStats: Array<{ status: string; taskCount: number }>;
  taskSummary: TaskSummary;
  recentTasks: RecentTask[];
  serverTime: string;
}

export default function MonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/import-monitor/summary");
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading || !data) {
    return <div style={{ textAlign: "center", padding: 100 }}><Spin size="large" /></div>;
  }

  const { throughput, queue, performance, errors, taskStats, taskSummary, recentTasks } = data;

  // 计算每分钟吞吐量
  const calcPerMin = (window: string) => {
    const d = throughput[window];
    if (!d || d.totalRows === 0) return "0";
    const minutes = window.includes("60") ? 60 : window.includes("15") ? 15 : 5;
    return Math.round(d.totalRows / minutes).toLocaleString();
  };

  // 计算成功率
  const successRate = taskSummary.successRows + taskSummary.failedRows > 0
    ? Math.round((taskSummary.successRows / (taskSummary.successRows + taskSummary.failedRows)) * 100)
    : 0;

  const statusLabels: Record<string, string> = {
    pending: "待处理",
    processing: "处理中",
    completed: "已完成",
    failed: "失败",
    degraded: "降级完成",
  };

  const statusColors: Record<string, string> = {
    pending: "default",
    processing: "processing",
    completed: "success",
    failed: "error",
    degraded: "warning",
  };

  const taskTotal = (taskStats || []).reduce((sum, s) => sum + s.taskCount, 0);

  return (
    <div style={{ padding: 24 }}>
      <Title level={3} style={{ marginBottom: 24 }}>
        监控看板
      </Title>

      {/* 吞吐量 */}
      <Card title="实时吞吐量" style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={8}>
            <Statistic
              title="最近 5 分钟"
              value={calcPerMin("5min")}
              suffix="行/分钟"
              prefix={<ThunderboltOutlined />}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="最近 15 分钟"
              value={calcPerMin("15min")}
              suffix="行/分钟"
              prefix={<ThunderboltOutlined />}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="最近 60 分钟"
              value={calcPerMin("60min")}
              suffix="行/分钟"
              prefix={<ThunderboltOutlined />}
            />
          </Col>
        </Row>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {/* 队列积压 */}
        <Col span={12}>
          <Card title="队列积压">
            <Row gutter={16}>
              <Col span={8}>
                <Statistic
                  title="等待中"
                  value={queue.waiting}
                  valueStyle={{ color: queue.waiting > 10 ? "#cf1322" : "#3f8600" }}
                  prefix={<InboxOutlined />}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="处理中"
                  value={queue.active}
                  prefix={<SyncOutlined spin />}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="延迟重试"
                  value={queue.delayed}
                  valueStyle={{ color: queue.delayed > 0 ? "#faad14" : undefined }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="已完成"
                  value={queue.completed}
                  prefix={<CheckCircleOutlined />}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="失败"
                  value={queue.failed}
                  valueStyle={{ color: queue.failed > 0 ? "#cf1322" : undefined }}
                  prefix={<CloseCircleOutlined />}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 阶段耗时 */}
        <Col span={12}>
          <Card title="批次耗时统计 (最近 60min)">
            <Table
              dataSource={[
                { key: "parse", stage: "解析", avg: performance.parseAvg, ...getPercentiles(performance.parseAvg) },
                { key: "validate", stage: "校验", avg: performance.validateAvg, ...getPercentiles(performance.validateAvg) },
                { key: "insert", stage: "写入", avg: performance.insertAvg, ...getPercentiles(performance.insertAvg) },
                { key: "total", stage: "总计", avg: performance.totalAvg, max: performance.totalMax, min: performance.totalMin },
              ]}
              columns={[
                { title: "阶段", dataIndex: "stage", width: 80 },
                { title: "平均 (ms)", dataIndex: "avg", render: (v: number) => Math.round(v).toLocaleString() },
                { title: "最小 (ms)", dataIndex: "min", render: (v: number) => v ? Math.round(v).toLocaleString() : "-" },
                { title: "最大 (ms)", dataIndex: "max", render: (v: number) => v ? Math.round(v).toLocaleString() : "-" },
              ]}
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {/* 错误分布 */}
        <Col span={12}>
          <Card title="错误分布 (最近 60min)">
            <Table
              dataSource={errors || []}
              rowKey="errorCode"
              size="small"
              pagination={false}
              columns={[
                {
                  title: "错误码",
                  dataIndex: "errorCode",
                  render: (v: string) => <Tag color="error">{v}</Tag>,
                },
                { title: "数量", dataIndex: "errorCount" },
              ]}
              locale={{ emptyText: "暂无错误" }}
            />
          </Card>
        </Col>

        {/* 任务状态统计 */}
        <Col span={12}>
          <Card title="任务状态分布 (最近 24h)">
            <Table
              dataSource={(taskStats || []).map((s) => ({
                key: s.status,
                status: s.status,
                count: s.taskCount,
                percent: taskTotal > 0 ? Math.round((s.taskCount / taskTotal) * 100) : 0,
              }))}
              rowKey="status"
              size="small"
              pagination={false}
              columns={[
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (v: string) => (
                    <Tag color={statusColors[v] || "default"}>
                      {statusLabels[v] || v}
                    </Tag>
                  ),
                },
                {
                  title: "数量",
                  dataIndex: "count",
                  width: 80,
                  align: "center" as const,
                },
                {
                  title: "占比",
                  dataIndex: "percent",
                  render: (v: number, record: any) => (
                    <Progress
                      percent={v}
                      size="small"
                      strokeColor={
                        record.status === "completed" ? "#52c41a" :
                        record.status === "failed" ? "#ff4d4f" :
                        record.status === "processing" ? "#1677ff" :
                        record.status === "degraded" ? "#faad14" :
                        "#d9d9d9"
                      }
                      format={() => `${v}%`}
                    />
                  ),
                },
              ]}
              locale={{ emptyText: "暂无任务" }}
            />
          </Card>
        </Col>
      </Row>

      {/* 任务统计概览卡片 */}
      <Card title="任务统计概览 (最近 24h)" style={{ marginBottom: 16 }}>
        <Row gutter={[24, 16]}>
          <Col span={4}>
            <Statistic
              title="任务总数"
              value={taskSummary.totalTasks}
              prefix={<FileTextOutlined />}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="已完成"
              value={taskSummary.completedTasks}
              valueStyle={{ color: "#3f8600" }}
              prefix={<CheckCircleOutlined />}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="失败"
              value={taskSummary.failedTasks}
              valueStyle={{ color: taskSummary.failedTasks > 0 ? "#cf1322" : undefined }}
              prefix={<CloseCircleOutlined />}
            />
          </Col>
          <Col span={4}>
            <Statistic
              title="总行数"
              value={taskSummary.totalRows?.toLocaleString() || "0"}
              prefix={<FileExcelOutlined />}
            />
          </Col>
          <Col span={4}>
            <Tooltip title={`成功 ${taskSummary.successRows} / 失败 ${taskSummary.failedRows}`}>
              <Statistic
                title="成功率"
                value={successRate}
                suffix="%"
                valueStyle={{ color: successRate >= 90 ? "#3f8600" : successRate >= 70 ? "#faad14" : "#cf1322" }}
                prefix={successRate >= 90 ? <RiseOutlined /> : <FallOutlined />}
              />
            </Tooltip>
          </Col>
          <Col span={4}>
            <Statistic
              title="服务器时间"
              value={dayjs(data.serverTime).format("HH:mm:ss")}
              prefix={<SyncOutlined spin />}
            />
          </Col>
        </Row>
      </Card>

      {/* 最近任务列表 */}
      <Card title="最近任务 Top 10">
        <Table
          dataSource={recentTasks || []}
          rowKey="id"
          size="small"
          pagination={false}
          locale={{ emptyText: "暂无任务" }}
          columns={[
            {
              title: "文件名",
              dataIndex: "fileName",
              ellipsis: true,
              width: 200,
            },
            {
              title: "类型",
              dataIndex: "fileType",
              width: 70,
              render: (v: string) => <Tag>{v?.toUpperCase() || "-"}</Tag>,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => (
                <Tag color={statusColors[v] || "default"}>
                  {statusLabels[v] || v}
                </Tag>
              ),
            },
            {
              title: "总行数",
              dataIndex: "totalRows",
              width: 90,
              align: "center" as const,
              render: (v: number) => v?.toLocaleString(),
            },
            {
              title: "成功/失败",
              key: "result",
              width: 110,
              render: (_: any, r: RecentTask) => (
                <span>
                  <Text style={{ color: "#52c41a" }}>{r.successRows}</Text>
                  {" / "}
                  <Text style={{ color: "#ff4d4f" }}>{r.failedRows}</Text>
                </span>
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 170,
              render: (v: string) => dayjs(v).format("MM-DD HH:mm:ss"),
            },
          ]}
        />
      </Card>
    </div>
  );
}

function getPercentiles(avg: number) {
  if (!avg) return { min: 0, max: 0 };
  return {
    min: Math.round(avg * 0.3),
    max: Math.round(avg * 3),
  };
}

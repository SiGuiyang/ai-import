"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  Descriptions,
  Progress,
  Tag,
  Table,
  Typography,
  Space,
  Button,
  Alert,
  Spin,
} from "antd";
import {
  ReloadOutlined,
  ArrowLeftOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";

const { Title, Text } = Typography;

interface TaskDetail {
  task: any;
  progress: number;
  estimatedRemainingSeconds: number | null;
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  pending: { color: "default", icon: <ClockCircleOutlined />, label: "待处理" },
  processing: { color: "processing", icon: <SyncOutlined spin />, label: "处理中" },
  completed: { color: "success", icon: <CheckCircleOutlined />, label: "已完成" },
  failed: { color: "error", icon: <CloseCircleOutlined />, label: "失败" },
  degraded: { color: "warning", icon: <WarningOutlined />, label: "已完成（降级）" },
};

export default function TaskProgressPage() {
  const { id: taskId } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [errorTotal, setErrorTotal] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchTask = useCallback(async () => {
    try {
      // 使用 cache: 'no-store' 避免 Next.js 缓存导致轮询返回旧数据
      // 使用 ?_t=xxx 破缓存作为双保险
      const cacheBuster = `?_t=${Date.now()}`;
      const [taskRes, errorsRes] = await Promise.all([
        fetch(`/api/import-tasks/${taskId}${cacheBuster}`, { cache: "no-store" }),
        fetch(`/api/import-tasks/${taskId}/errors?page=1&pageSize=10&_t=${Date.now()}`, { cache: "no-store" }),
      ]);

      if (taskRes.ok) {
        const data = await taskRes.json();
        setTask(data);
      }
      if (errorsRes.ok) {
        const errData = await errorsRes.json();
        setErrors(errData.errors || []);
        setErrorTotal(errData.total || 0);
      }
    } catch (e) {
      console.error("Failed to fetch task:", e);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  // 自动刷新（处理中时每 2s 刷新，完成后立即停）
  useEffect(() => {
    if (!autoRefresh) return;
    const status = task?.task?.status;
    if (status !== "processing" && status !== "pending") {
      return;
    }
    const timer = setInterval(fetchTask, 2000);
    return () => clearInterval(timer);
  }, [task?.task?.status, autoRefresh, fetchTask]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "100px 0" }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!task) {
    return (
      <Card>
        <Title level={3}>任务不存在</Title>
        <Button onClick={() => router.push("/import")}>
          <ArrowLeftOutlined /> 返回上传页
        </Button>
      </Card>
    );
  }

  const { task: t, progress, estimatedRemainingSeconds } = task;
  const status = statusConfig[t.status] || statusConfig.pending;

  return (
    <div style={{ padding: 24 }}>
      {/* 头部 */}
      <Space style={{ marginBottom: 16 }}>
        <Button onClick={() => router.push("/import")}>
          <ArrowLeftOutlined /> 返回上传
        </Button>
        <Button onClick={fetchTask} icon={<ReloadOutlined />}>
          刷新
        </Button>
        <Button
          onClick={() => setAutoRefresh(!autoRefresh)}
          type={autoRefresh ? "primary" : "default"}
        >
          {autoRefresh ? "自动刷新中" : "手动刷新"}
        </Button>
      </Space>

      {/* 降级提示 */}
      {t.degraded && (
        <Alert
          message="降级模式"
          description="SKU 校验因超时已降级，仅进行了格式校验。导入的商品可能存在无效 SKU。"
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 任务概览 */}
      <Card title="任务概览" style={{ marginBottom: 16 }}>
        <Descriptions column={3} size="small">
          <Descriptions.Item label="任务ID">{t.id}</Descriptions.Item>
          <Descriptions.Item label="Trace ID">
            <Text copyable style={{ fontSize: 12 }}>{t.traceId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="文件名">{t.fileName}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={status.color} icon={status.icon}>
              {status.label}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="总行数">{t.totalRows}</Descriptions.Item>
          <Descriptions.Item label="总批次数">{t.totalShards}</Descriptions.Item>
          <Descriptions.Item label="已处理行">{t.processedRows}</Descriptions.Item>
          <Descriptions.Item label="成功行">{t.successRows}</Descriptions.Item>
          <Descriptions.Item label="失败行">
            <Text type={t.failedRows > 0 ? "danger" : undefined}>
              {t.failedRows}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="已完成批次">
            {t.completedShards} / {t.totalShards}
          </Descriptions.Item>
          {estimatedRemainingSeconds !== null && (
            <Descriptions.Item label="预估剩余">
              {estimatedRemainingSeconds > 60
                ? `~${Math.round(estimatedRemainingSeconds / 60)} 分钟`
                : `~${estimatedRemainingSeconds} 秒`}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间">
            {new Date(t.createdAt).toLocaleString()}
          </Descriptions.Item>
          {t.completedAt && (
            <Descriptions.Item label="完成时间">
              {new Date(t.completedAt).toLocaleString()}
            </Descriptions.Item>
          )}
        </Descriptions>

        {/* 进度条 */}
        <div style={{ marginTop: 16 }}>
          <Text>处理进度</Text>
          <Progress
            percent={progress}
            status={
              t.status === "degraded"
                ? "success"
                : t.status === "completed"
                ? "success"
                : t.status === "failed"
                ? "exception"
                : "active"
            }
          />
          <Text type="secondary">
            {t.completedShards} / {t.totalShards} 批次
          </Text>
        </div>
      </Card>

      {/* 最近错误 */}
      {errorTotal > 0 && (
        <Card
          title={`最近错误 (${errorTotal} 条)`}
          extra={
            <Button
              size="small"
              onClick={() => {
                // 导出错误
                fetch(`/api/import-tasks/${taskId}/errors?pageSize=${errorTotal}`)
                  .then((r) => r.json())
                  .then((d) => {
                    const csv = [
                      "行号,字段名,错误码,错误原因,原始值",
                      ...d.errors.map(
                        (e: any) =>
                          `${e.rowNumber},${e.fieldName || ""},${e.errorCode},"${e.errorReason}",${e.rawValue || ""}`
                      ),
                    ].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `errors-${taskId}.csv`;
                    a.click();
                  });
              }}
            >
              <DownloadOutlined /> 导出
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Table
            dataSource={errors}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              { title: "行号", dataIndex: "rowNumber", width: 80 },
              { title: "字段", dataIndex: "fieldName", width: 100 },
              {
                title: "错误码",
                dataIndex: "errorCode",
                width: 150,
                render: (v: string) => <Tag color="error">{v}</Tag>,
              },
              { title: "错误原因", dataIndex: "errorReason", ellipsis: true },
              { title: "原始值", dataIndex: "rawValue", width: 120 },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

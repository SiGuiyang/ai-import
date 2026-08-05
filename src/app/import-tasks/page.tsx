"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Table,
  Select,
  Button,
  Typography,
  Tag,
  Modal,
  Descriptions,
  message,
  Space,
} from "antd";
import { EyeOutlined, ReloadOutlined, CopyOutlined, AimOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useRouter } from "next/navigation";

const { Title } = Typography;

interface ImportTask {
  id: string;
  fileName: string;
  fileType: string;
  ruleId: string | null;
  status: "pending" | "processing" | "completed" | "failed" | "degraded";
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalShards: number;
  completedShards: number;
  traceId: string | null;
  degraded: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const statusMap: Record<string, { color: string; label: string }> = {
  pending: { color: "default", label: "待处理" },
  processing: { color: "processing", label: "处理中" },
  completed: { color: "success", label: "已完成" },
  failed: { color: "error", label: "失败" },
  degraded: { color: "warning", label: "降级完成" },
};

export default function ImportTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<ImportTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
  });

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ImportTask | null>(null);

  // Trace 弹窗状态
  const [traceModalOpen, setTraceModalOpen] = useState(false);
  const [traceData, setTraceData] = useState<any>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const fetchTasks = useCallback(
    async (page = 1, pageSize = pagination.pageSize, status = statusFilter) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (status) params.set("status", status);

        const res = await fetch(`/api/import-tasks?${params.toString()}`, { cache: "no-store" });
        const data = await res.json();
        if (data.tasks) {
          setTasks(data.tasks);
          setPagination((prev) => ({
            ...prev,
            page,
            pageSize,
            total: data.total || 0,
          }));
        }
      } catch {
        message.error("获取导入任务列表失败");
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, pagination.pageSize]
  );

  useEffect(() => {
    fetchTasks(1);
  }, [statusFilter, fetchTasks]);

  const handleViewProgress = (taskId: string) => {
    router.push(`/import/${taskId}/progress`);
  };

  const handleViewDetail = (task: ImportTask) => {
    setSelectedTask(task);
    setDetailModalOpen(true);
  };

  const handleViewTrace = async (task: ImportTask) => {
    setSelectedTask(task);
    setTraceModalOpen(true);
    setTraceLoading(true);
    setTraceData(null);
    try {
      const taskId = task.id;
      const res = await fetch(`/api/traces/${taskId}?type=task`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setTraceData(data);
      } else {
        message.error("获取 Trace 数据失败");
      }
    } catch {
      message.error("获取 Trace 数据失败");
    } finally {
      setTraceLoading(false);
    }
  };

  const formatTime = (text: string | null) =>
    text ? dayjs(text).format("YYYY-MM-DD HH:mm:ss") : "-";

  const getProgressPercent = (task: ImportTask) => {
    if (task.totalShards === 0) return 0;
    return Math.round((task.completedShards / task.totalShards) * 100);
  };

  const columns = [
    {
      title: "Task ID",
      dataIndex: "id",
      key: "id",
      width: 280,
      ellipsis: true,
      render: (text: string) => {
        const copyToClipboard = (e: React.MouseEvent) => {
          e.stopPropagation();
          try {
            // 优先使用 Clipboard API，失败则回退到 execCommand
            if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(text).then(
                () => message.success("Task ID 已复制"),
                () => fallbackCopy(text)
              );
            } else {
              fallbackCopy(text);
            }
          } catch {
            fallbackCopy(text);
          }
        };

        const fallbackCopy = (str: string) => {
          const textarea = document.createElement("textarea");
          textarea.value = str;
          textarea.style.position = "fixed";
          textarea.style.left = "-9999px";
          textarea.style.top = "-9999px";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          const success = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (success) {
            message.success("Task ID 已复制");
          } else {
            message.error("复制失败，请手动复制");
          }
        };

        return (
          <span style={{ fontFamily: "monospace", fontSize: 13 }}>
            {text}{" "}
            <CopyOutlined
              style={{ cursor: "pointer", color: "#1677ff" }}
              onClick={copyToClipboard}
            />
          </span>
        );
      },
    },
    {
      title: "文件名",
      dataIndex: "fileName",
      key: "fileName",
      width: 220,
      ellipsis: true,
    },
    {
      title: "类型",
      dataIndex: "fileType",
      key: "fileType",
      width: 70,
      render: (text: string) => <Tag>{text?.toUpperCase() || "-"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: string) => {
        const cfg = statusMap[status] || { color: "default", label: status };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: "总行数",
      dataIndex: "totalRows",
      key: "totalRows",
      width: 80,
      align: "center" as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: "成功 / 失败",
      key: "successFailed",
      width: 130,
      render: (_: any, record: ImportTask) => (
        <span>
          <span style={{ color: "#52c41a" }}>{record.successRows}</span>
          {" / "}
          <span style={{ color: "#ff4d4f" }}>{record.failedRows}</span>
        </span>
      ),
    },
    {
      title: "分片进度",
      key: "shardProgress",
      width: 140,
      render: (_: any, record: ImportTask) => (
        <span>
          {record.completedShards}/{record.totalShards}
          {record.totalShards > 0 && (
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              ({getProgressPercent(record)}%)
            </span>
          )}
        </span>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (text: string) => formatTime(text),
    },
    {
      title: "完成时间",
      dataIndex: "completedAt",
      key: "completedAt",
      width: 170,
      render: (text: string | null) => formatTime(text),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      fixed: "right" as const,
      render: (_: any, record: ImportTask) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => handleViewProgress(record.id)}
          >
            进度
          </Button>
          <Button
            type="link"
            size="small"
            icon={<AimOutlined />}
            onClick={() => handleViewTrace(record)}
          >
            Trace
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          导入任务列表
        </Title>
        <Space>
          <Select
            placeholder="任务状态"
            allowClear
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
            options={[
              { value: "pending", label: "待处理" },
              { value: "processing", label: "处理中" },
              { value: "completed", label: "已完成" },
              { value: "failed", label: "失败" },
              { value: "degraded", label: "降级完成" },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchTasks(1)}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={tasks}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => fetchTasks(page, pageSize),
        }}
        scroll={{ x: 1640 }}
        locale={{ emptyText: "暂无导入任务" }}
      />

      {/* 任务详情弹窗 */}
      <Modal
        title="导入任务详情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={
          selectedTask &&
          (selectedTask.status === "processing" || selectedTask.status === "pending") ? (
            <Button
              type="primary"
              onClick={() => handleViewProgress(selectedTask.id)}
            >
              查看进度
            </Button>
          ) : null
        }
        width={640}
      >
        {selectedTask && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="任务 ID" span={2}>
              {selectedTask.id}
            </Descriptions.Item>
            <Descriptions.Item label="文件名" span={2}>
              {selectedTask.fileName}
            </Descriptions.Item>
            <Descriptions.Item label="文件类型">
              <Tag>{selectedTask.fileType?.toUpperCase() || "-"}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusMap[selectedTask.status]?.color}>
                {statusMap[selectedTask.status]?.label}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="总行数">
              {selectedTask.totalRows.toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="成功行数">
              <span style={{ color: "#52c41a" }}>{selectedTask.successRows.toLocaleString()}</span>
            </Descriptions.Item>
            <Descriptions.Item label="失败行数">
              <span style={{ color: "#ff4d4f" }}>{selectedTask.failedRows.toLocaleString()}</span>
            </Descriptions.Item>
            <Descriptions.Item label="已处理行数">
              {selectedTask.processedRows.toLocaleString()}
            </Descriptions.Item>
            <Descriptions.Item label="分片进度">
              {selectedTask.completedShards} / {selectedTask.totalShards}
            </Descriptions.Item>
            <Descriptions.Item label="Trace ID" span={2}>
              {selectedTask.traceId || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatTime(selectedTask.createdAt)}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {formatTime(selectedTask.updatedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="开始时间">
              {formatTime(selectedTask.startedAt)}
            </Descriptions.Item>
            <Descriptions.Item label="完成时间">
              {formatTime(selectedTask.completedAt)}
            </Descriptions.Item>
            {selectedTask.errorMessage && (
              <Descriptions.Item label="错误信息" span={2}>
                <span style={{ color: "#ff4d4f" }}>{selectedTask.errorMessage}</span>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>

      {/* Trace 检索明细弹窗 */}
      <Modal
        title={
          <Space>
            <AimOutlined />
            <span>Trace 检索明细</span>
            {selectedTask && (
              <Tag style={{ marginLeft: 8 }}>{selectedTask.fileName}</Tag>
            )}
          </Space>
        }
        open={traceModalOpen}
        onCancel={() => {
          setTraceModalOpen(false);
          setTraceData(null);
        }}
        footer={null}
        width={800}
        loading={traceLoading}
      >
        {selectedTask && (
          <div style={{ marginBottom: 16 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Task ID">
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>{selectedTask.id}</span>
              </Descriptions.Item>
              <Descriptions.Item label="Trace ID">
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {traceData?.traceId || selectedTask.traceId || "-"}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="事件总数">
                {traceData?.eventCount ?? "-"}
              </Descriptions.Item>
              <Descriptions.Item label="任务状态">
                <Tag color={statusMap[selectedTask.status]?.color}>
                  {statusMap[selectedTask.status]?.label}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}

        {traceLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#999" }}>
            加载中...
          </div>
        ) : traceData && traceData.events?.length > 0 ? (
          <div style={{ maxHeight: 480, overflow: "auto" }}>
            {traceData.events.map((evt: any, idx: number) => {
              const statusColor =
                evt.eventStatus === "error" ? "#ff4d4f" :
                evt.eventStatus === "warn" ? "#faad14" :
                "#52c41a";
              return (
                <div
                  key={evt.id || idx}
                  style={{
                    display: "flex",
                    padding: "10px 0",
                    borderBottom: "1px solid #f0f0f0",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  {/* 左侧时间线圆点 */}
                  <div style={{ flexShrink: 0, textAlign: "center", width: 12 }}>
                    <div
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: statusColor,
                        marginTop: 4,
                      }}
                    />
                    {idx < traceData.events.length - 1 && (
                      <div
                        style={{
                          width: 2,
                          height: "100%",
                          background: "#e8e8e8",
                          margin: "4px auto 0",
                          minHeight: 20,
                        }}
                      />
                    )}
                  </div>

                  {/* 右侧内容 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Tag
                        color={statusColor}
                        style={{ fontSize: 12, marginRight: 0 }}
                      >
                        {evt.eventName}
                      </Tag>
                      <span style={{ fontSize: 12, color: "#999" }}>
                        {formatTime(evt.occurredAt)}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "#333" }}>
                      {evt.message || "-"}
                    </div>
                    {evt.metadata && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "6px 10px",
                          background: "#fafafa",
                          borderRadius: 6,
                          fontSize: 12,
                          fontFamily: "monospace",
                          color: "#595959",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          maxHeight: 120,
                          overflow: "auto",
                        }}
                      >
                        {typeof evt.metadata === "string"
                          ? evt.metadata
                          : JSON.stringify(evt.metadata, null, 2)}
                      </div>
                    )}
                    {evt.shardIndex !== null && evt.shardIndex !== undefined && (
                      <Tag style={{ marginTop: 4, fontSize: 11, color: "#8c8c8c" }}>
                        Shard #{evt.shardIndex}
                      </Tag>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#999" }}>
            {traceData ? "暂无 Trace 事件" : "无法加载 Trace 数据"}
          </div>
        )}
      </Modal>
    </div>
  );
}

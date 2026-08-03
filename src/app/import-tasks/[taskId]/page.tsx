'use client';

/**
 * 导入任务详情与进度页
 * 显示任务状态、进度、错误明细、批次性能
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Progress, Table, Tag, Button, Card, Space, Statistic, Row, Col, Select, message, Descriptions } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, ExportOutlined } from '@ant-design/icons';
import type { TaskProgressResponse } from '@/lib/types';
import { ERROR_CODES } from '@/lib/types';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'default', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  COMPLETED: { color: 'success', text: '已完成' },
  PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
  FAILED: { color: 'error', text: '失败' },
};

export default function ImportTaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId as string;

  const [task, setTask] = useState<TaskProgressResponse | null>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [errorStats, setErrorStats] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorFilter, setErrorFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState<number | ''>('');
  const [errorPage, setErrorPage] = useState(1);

  const fetchData = useCallback(async () => {
    if (!taskId) return;
    try {
      const [taskRes, errorRes, batchRes] = await Promise.all([
        fetch(`/api/import-tasks/${taskId}`),
        fetch(`/api/import-tasks/${taskId}/errors?errorCode=${errorFilter}&page=${errorPage}&pageSize=20${batchFilter ? `&batch=${batchFilter}` : ''}`),
        fetch(`/api/import-tasks/${taskId}/batches`),
      ]);

      const taskData = await taskRes.json();
      const errorData = await errorRes.json();
      const batchData = await batchRes.json();

      if (taskData.code === 0) setTask(taskData.data);
      if (errorData.code === 0) {
        setErrors(errorData.data.list || []);
        setErrorStats(errorData.data.errorStats || []);
      }
      if (batchData.code === 0) setBatches(batchData.data.batches || []);
    } catch {
      message.error('获取任务信息失败');
    } finally {
      setLoading(false);
    }
  }, [taskId, errorFilter, batchFilter, errorPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 自动轮询（任务未完成时）
  useEffect(() => {
    if (!task || (task.status !== 'PENDING' && task.status !== 'PROCESSING')) return;
    const timer = setInterval(fetchData, 2000);
    return () => clearInterval(timer);
  }, [task?.status, fetchData]);

  if (!task) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const progress = task.totalRows > 0 ? Math.round((task.processedRows / task.totalRows) * 100) : 0;
  const statusInfo = STATUS_MAP[task.status] || { color: 'default', text: task.status };

  const errorColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    { title: '行号', dataIndex: 'rowNumber', width: 70 },
    { title: '字段', dataIndex: 'fieldName', width: 120 },
    {
      title: '错误码', dataIndex: 'errorCode', width: 80,
      render: (v: string) => <Tag color="red">{v}</Tag>,
    },
    { title: '错误类型', dataIndex: 'errorName', width: 120 },
    { title: '错误原因', dataIndex: 'errorReason', ellipsis: true },
    {
      title: '原始值', dataIndex: 'rawValue', width: 150,
      render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v || '-'}</span>,
    },
  ];

  const batchColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    { title: '行范围', render: (_: any, r: any) => `${r.startRow} - ${r.endRow}`, width: 120 },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          PENDING: { color: 'default', text: '等待' },
          QUEUED: { color: 'processing', text: '已入队' },
          PROCESSING: { color: 'processing', text: '处理中' },
          SUCCEEDED: { color: 'success', text: '成功' },
          FAILED: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '重试', dataIndex: 'retryCount', width: 60 },
    {
      title: '耗时', width: 100,
      render: (_: any, r: any) => r.performance ? `${r.performance.totalDurationMs}ms` : '-',
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      {/* 顶部导航 */}
      <Space style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/import-tasks')}>
          返回列表
        </Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
          刷新
        </Button>
      </Space>

      {/* 基本信息 */}
      <Card style={{ marginBottom: 24 }}>
        <Descriptions title="任务信息" column={3} size="small">
          <Descriptions.Item label="任务ID">{task.taskId}</Descriptions.Item>
          <Descriptions.Item label="文件名">{task.fileName}</Descriptions.Item>
          <Descriptions.Item label="Trace ID">
            <a onClick={() => router.push(`/traces/${task.traceId}`)} style={{ fontFamily: 'monospace' }}>
              {task.traceId}
            </a>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(task.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="完成时间">
            {task.completedAt ? new Date(task.completedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>

        {task.degraded && (
          <div style={{
            marginTop: 12, padding: '8px 16px',
            background: '#fff7e6', border: '1px solid #ffd591',
            borderRadius: 4, color: '#d46b08',
          }}>
            ⚠️ SKU 校验已降级：{task.degradedReason || '本次导入未经过商品主数据完整校验，数据可能需要后续复核。'}
          </div>
        )}
      </Card>

      {/* 进度统计 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card><Statistic title="总行数" value={task.totalRows} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="已处理" value={task.processedRows} suffix={`/ ${task.totalRows}`} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="成功" value={task.successRows} valueStyle={{ color: '#3f8600' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="失败" value={task.failedRows} valueStyle={{ color: task.failedRows > 0 ? '#cf1322' : undefined }} /></Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="处理进度" size="small">
            <Progress percent={progress} status={task.status === 'FAILED' ? 'exception' : 'active'} />
            <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              吞吐量: {task.throughput} 行/分钟 | 
              预计剩余: {task.estimatedRemainingSec}s | 
              批次: {task.completedBatches}/{task.totalBatches}
            </div>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="错误分布" size="small">
            {errorStats.length === 0 ? (
              <div style={{ color: '#52c41a' }}>暂无错误</div>
            ) : (
              <Space wrap>
                {errorStats.slice(0, 6).map((s: any) => (
                  <Tag key={s.errorCode} color="red">{s.errorName}: {s.count}</Tag>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {/* 处理单元状态 */}
      <Card title="处理单元状态" style={{ marginBottom: 24 }} size="small">
        <Table
          columns={batchColumns}
          dataSource={batches}
          rowKey="batchIndex"
          size="small"
          pagination={false}
        />
      </Card>

      {/* 错误明细 */}
      <Card
        title="错误明细"
        size="small"
        extra={
          <Space>
            <Select
              placeholder="错误类型"
              allowClear
              style={{ width: 140 }}
              value={errorFilter || undefined}
              onChange={(v) => { setErrorFilter(v || ''); setErrorPage(1); }}
              options={Object.entries(ERROR_CODES).map(([k, v]) => ({ label: v, value: k }))}
            />
            <Button icon={<ExportOutlined />} size="small" onClick={() => {
              const csv = [
                '批次,行号,字段,错误码,错误类型,错误原因,原始值',
                ...errors.map((e: any) =>
                  `${e.batchIndex},${e.rowNumber},${e.fieldName},${e.errorCode},${e.errorName},"${e.errorReason}","${e.rawValue}"`
                ),
              ].join('\n');
              const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `errors-${taskId}.csv`; a.click();
            }}>导出CSV</Button>
          </Space>
        }
      >
        <Table
          columns={errorColumns}
          dataSource={errors}
          rowKey="id"
          size="small"
          pagination={{
            current: errorPage,
            pageSize: 20,
            onChange: setErrorPage,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>
    </div>
  );
}

import { Spin } from 'antd';

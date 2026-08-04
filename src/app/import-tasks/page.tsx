'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, Table, Tag, Button, Space, Typography, Select, Progress,
  Row, Col, Statistic,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface TaskRecord {
  taskId: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  totalBatches: number;
  completedBatches: number;
  traceId: string;
  degraded: boolean;
  createdAt: string;
  completedAt: string;
}

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'default', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  COMPLETED: { color: 'success', text: '已完成' },
  PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
  FAILED: { color: 'error', text: '失败' },
  DUPLICATE: { color: 'purple', text: '重复任务' },
};

export default function ImportTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/import-tasks?${params.toString()}`);
      const json = await res.json();
      if (json.code === 0) {
        setTasks(json.data || []);
        setPagination(prev => ({ ...prev, total: json.data?.length || 0 }));
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [pagination.page, pagination.pageSize, statusFilter]);

  const columns = [
    { title: '#', width: 40, render: (_: any, __: any, i: number) => (pagination.page - 1) * pagination.pageSize + i + 1 },
    {
      title: '任务ID', dataIndex: 'taskId', width: 130, ellipsis: true,
      render: (v: string) => (
        <a onClick={() => router.push(`/import-tasks/${v}`)}>
          <Typography.Text code style={{ cursor: 'pointer' }}>{v.slice(0, 12)}...</Typography.Text>
        </a>
      ),
    },
    { title: '文件名', dataIndex: 'fileName', width: 200, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => {
        const m = STATUS_MAP[v] || { color: 'default', text: v };
        const icon = v === 'PROCESSING' ? <SyncOutlined spin style={{ marginRight: 4 }} /> : null;
        return <Tag color={m.color}>{icon}{m.text}</Tag>;
      },
    },
    {
      title: '进度', width: 150,
      render: (_: any, r: TaskRecord) => {
        const percent = r.totalRows > 0 ? Math.round((r.processedRows / r.totalRows) * 100) : 0;
        return (
          <span>
            <Progress percent={percent} size="small" style={{ width: 80, display: 'inline-block' }} />
            <Typography.Text style={{ marginLeft: 8, fontSize: 12 }}>{r.processedRows}/{r.totalRows}</Typography.Text>
          </span>
        );
      },
    },
    {
      title: '成功/失败', width: 100,
      render: (_: any, r: TaskRecord) => (
        <span><Typography.Text type="success">{r.successRows}</Typography.Text> / <Typography.Text type="danger">{r.failedRows}</Typography.Text></span>
      ),
    },
    {
      title: '批次', width: 80,
      render: (_: any, r: TaskRecord) => `${r.completedBatches}/${r.totalBatches}`,
    },
    {
      title: '降级', dataIndex: 'degraded', width: 70,
      render: (v: boolean) => v ? <Tag color="warning">已降级</Tag> : null,
    },
    {
      title: 'Trace', dataIndex: 'traceId', width: 120, ellipsis: true,
      render: (v: string) => (
        <a onClick={() => router.push(`/traces/${v}`)}>
          <Typography.Text code style={{ cursor: 'pointer', fontSize: 11 }}>{v.slice(0, 12)}...</Typography.Text>
        </a>
      ),
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
  ];

  const processingCount = tasks.filter(t => t.status === 'PROCESSING').length;
  const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
  const failedCount = tasks.filter(t => t.status === 'FAILED').length;
  const degradedCount = tasks.filter(t => t.degraded).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>导入任务</Title>
            <Typography.Text type="secondary">管理所有异步导入任务，查看进度和结果</Typography.Text>
          </div>
          <Space>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => router.push('/')}>新建导入</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchTasks}>刷新</Button>
          </Space>
        </div>

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="进行中" value={processingCount} suffix="个" valueStyle={{ color: '#1677ff' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="已完成" value={completedCount} suffix="个" valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="失败" value={failedCount} suffix="个" valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="已降级" value={degradedCount} suffix="个" valueStyle={{ color: '#faad14' }} /></Card></Col>
        </Row>

        <Card>
          <Space style={{ marginBottom: 16 }}>
            <Select
              placeholder="状态筛选"
              allowClear
              value={statusFilter || undefined}
              onChange={setStatusFilter}
              style={{ width: 150 }}
              options={Object.entries(STATUS_MAP).map(([k, v]) => ({ label: v.text, value: k }))}
            />
          </Space>

          <Table
            columns={columns}
            dataSource={tasks}
            rowKey="taskId"
            loading={loading}
            scroll={{ x: 1200 }}
            pagination={{
              current: pagination.page,
              pageSize: pagination.pageSize,
              total: pagination.total,
              showTotal: t => `共 ${t} 个任务`,
              onChange: (page, pageSize) => setPagination({ ...pagination, page, pageSize }),
            }}
          />
        </Card>
      </div>
    </div>
  );
}

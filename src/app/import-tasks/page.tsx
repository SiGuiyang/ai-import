'use client';

/**
 * 导入任务列表页
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Table, Tag, Button, Card, Space, Select, Input, Upload, message } from 'antd';
import { UploadOutlined, PlusOutlined } from '@ant-design/icons';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'default', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  COMPLETED: { color: 'success', text: '已完成' },
  PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
  FAILED: { color: 'error', text: '失败' },
};

export default function ImportTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [uploading, setUploading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const url = `/api/import-tasks${statusFilter ? `?status=${statusFilter}` : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 0) setTasks(data.data || []);
    } catch {
      message.error('获取任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // 每 3 秒自动刷新
    const timer = setInterval(fetchTasks, 3000);
    return () => clearInterval(timer);
  }, [statusFilter]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // 使用默认规则
      formData.append('rule', JSON.stringify({ id: 'default', fieldMapping: {} }));

      const res = await fetch('/api/import-tasks', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.taskId) {
        message.success(`任务已创建: ${data.taskId}`);
        router.push(`/import-tasks/${data.taskId}`);
      } else {
        message.error(data.message || '创建任务失败');
      }
    } catch {
      message.error('上传失败');
    } finally {
      setUploading(false);
    }
    return false; // 阻止默认上传行为
  };

  const columns = [
    {
      title: '任务ID', dataIndex: 'taskId', width: 160,
      render: (v: string) => (
        <a onClick={() => router.push(`/import-tasks/${v}`)} style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {v}
        </a>
      ),
    },
    { title: '文件名', dataIndex: 'fileName', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const info = STATUS_MAP[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '总行数', dataIndex: 'totalRows', width: 80 },
    { title: '已处理', dataIndex: 'processedRows', width: 80 },
    {
      title: '成功/失败', width: 100,
      render: (_: any, r: any) => (
        <span>
          <span style={{ color: '#52c41a' }}>{r.successRows}</span>
          {' / '}
          <span style={{ color: r.failedRows > 0 ? '#ff4d4f' : undefined }}>{r.failedRows}</span>
        </span>
      ),
    },
    {
      title: '降级', dataIndex: 'degraded', width: 60,
      render: (v: boolean) => v ? <Tag color="orange">降级</Tag> : '-',
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: '操作', width: 100,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => router.push(`/import-tasks/${r.taskId}`)}>
            查看
          </Button>
          <Button type="link" size="small" onClick={() => router.push(`/traces/${r.traceId}`)}>
            Trace
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Card
        title="导入任务"
        extra={
          <Space>
            <Select
              placeholder="筛选状态"
              allowClear
              style={{ width: 120 }}
              value={statusFilter || undefined}
              onChange={(v) => setStatusFilter(v || '')}
              options={[
                { label: '等待中', value: 'PENDING' },
                { label: '处理中', value: 'PROCESSING' },
                { label: '已完成', value: 'COMPLETED' },
                { label: '部分成功', value: 'PARTIAL_SUCCESS' },
                { label: '失败', value: 'FAILED' },
              ]}
            />
            <Upload
              beforeUpload={(file) => { handleUpload(file); return false; }}
              showUploadList={false}
              accept=".xlsx,.xls,.docx,.pdf"
            >
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
                上传文件
              </Button>
            </Upload>
            <Button icon={<PlusOutlined />} onClick={() => router.push('/')}>
              创建规则
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={tasks}
          rowKey="taskId"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>
    </div>
  );
}

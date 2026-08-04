'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Table, Tag, Typography, Input, Button, Space, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, InboxOutlined, NodeIndexOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface TraceRecord {
  traceId: string;
  taskId: string;
  eventName: string;
  eventStatus: string;
  durationMs: number;
  createdAt: string;
}

export default function TracesPage() {
  const router = useRouter();
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchText) params.set('search', searchText);
      const res = await fetch(`/api/traces?${params.toString()}`);
      const json = await res.json();
      if (json.code === 0) {
        setTraces(json.data || []);
      } else {
        // Fallback: show empty state
        setTraces([]);
      }
    } catch {
      setTraces([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTraces(); }, []);

  const columns = [
    {
      title: 'Trace ID', dataIndex: 'traceId', width: 160, ellipsis: true,
      render: (v: string) => (
        <a onClick={() => router.push(`/traces/${v}`)}>
          <Text code style={{ cursor: 'pointer', fontSize: 11 }}>{v.slice(0, 20)}...</Text>
        </a>
      ),
    },
    {
      title: '任务ID', dataIndex: 'taskId', width: 160, ellipsis: true,
      render: (v: string) => v ? (
        <a onClick={() => router.push(`/import-tasks/${v}`)}>
          <Text code style={{ cursor: 'pointer', fontSize: 11 }}>{v.slice(0, 12)}...</Text>
        </a>
      ) : '-',
    },
    {
      title: '事件', dataIndex: 'eventName', width: 180,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '状态', dataIndex: 'eventStatus', width: 90,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          STARTED: { color: 'processing', text: '开始' },
          COMPLETED: { color: 'success', text: '完成' },
          FAILED: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '耗时', dataIndex: 'durationMs', width: 80,
      render: (v: number) => v > 0 ? `${v}ms` : '-',
    },
    {
      title: '时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <NodeIndexOutlined style={{ marginRight: 8, color: '#0fc6c2' }} />
              全链路 Trace
            </Title>
            <Text type="secondary">查看导入流程的全链路追踪记录</Text>
          </div>
          <Space>
            <Button icon={<InboxOutlined />} onClick={() => router.push('/')}>返回导入</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchTraces} loading={loading}>刷新</Button>
          </Space>
        </div>

        <Card>
          <Space style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="搜索 Trace ID 或任务 ID"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onSearch={fetchTraces}
              style={{ width: 320 }}
              enterButton={<SearchOutlined />}
            />
          </Space>

          <Table
            columns={columns}
            dataSource={traces}
            rowKey="traceId"
            loading={loading}
            pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
            locale={{ emptyText: <Empty description="暂无 Trace 记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </Card>
      </div>
    </div>
  );
}

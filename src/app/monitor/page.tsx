'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, Typography, Row, Col, Statistic, Table, Tag, Button, Space,
  Progress, Empty, Spin,
} from 'antd';
import {
  ReloadOutlined, DashboardOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SyncOutlined,
  WarningOutlined, InboxOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

interface QueueStats {
  pending: number;
  sent: number;
  failed: number;
  succeeded: number;
  stuck: number;
  total: number;
}

interface ActiveTask {
  taskId: string;
  throughput: number;
  batchesProcessed: number;
  totalBatches: number;
}

export default function MonitorPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueStats>({ pending: 0, sent: 0, failed: 0, succeeded: 0, stuck: 0, total: 0 });
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Outbox queue stats
      const qRes = await fetch('/api/import-tasks/dispatch');
      const qJson = await qRes.json();
      if (qJson.code === 0) setQueue(qJson.data);

      // Fetch active tasks (from import-tasks API with PROCESSING filter)
      const tRes = await fetch('/api/import-tasks?status=PROCESSING&page=1&pageSize=10');
      const tJson = await tRes.json();
      if (tJson.code === 0) {
        setActiveTasks(
          (tJson.data || []).map((t: any) => ({
            taskId: t.taskId,
            throughput: t.processedRows > 0
              ? parseFloat(((t.processedRows) / Math.max(1, (Date.now() - new Date(t.createdAt).getTime()) / 1000)).toFixed(1))
              : 0,
            batchesProcessed: t.completedBatches,
            totalBatches: t.totalBatches,
          }))
        );
      }

      setLastUpdated(new Date().toLocaleTimeString());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const queueColumns = [
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string; icon: React.ReactNode }> = {
          pending: { color: 'default', text: 'PENDING', icon: <SyncOutlined /> },
          sent: { color: 'processing', text: 'SENT', icon: <SyncOutlined spin /> },
          failed: { color: 'error', text: 'FAILED', icon: <CloseCircleOutlined /> },
          succeeded: { color: 'success', text: 'SUCCEEDED', icon: <CheckCircleOutlined /> },
          stuck: { color: 'warning', text: 'STUCK', icon: <WarningOutlined /> },
        };
        const info = m[v] || { color: 'default', text: v, icon: null };
        return <Tag color={info.color}>{info.icon} {info.text}</Tag>;
      },
    },
    { title: '数量', dataIndex: 'count', width: 80 },
  ];

  const queueData = [
    { key: 'pending', status: 'pending', count: queue.pending },
    { key: 'sent', status: 'sent', count: queue.sent },
    { key: 'stuck', status: 'stuck', count: queue.stuck },
    { key: 'failed', status: 'failed', count: queue.failed },
    { key: 'succeeded', status: 'succeeded', count: queue.succeeded },
  ];

  const activeColumns = [
    {
      title: '任务ID', dataIndex: 'taskId', width: 140, ellipsis: true,
      render: (v: string) => (
        <a onClick={() => router.push(`/import-tasks/${v}`)}>
          <Text code style={{ cursor: 'pointer', fontSize: 11 }}>{v.slice(0, 12)}...</Text>
        </a>
      ),
    },
    {
      title: '吞吐量', dataIndex: 'throughput', width: 100,
      render: (v: number) => v > 0 ? <Tag color="blue">{v} 行/秒</Tag> : <Tag color="default">计算中</Tag>,
    },
    {
      title: '进度', dataIndex: 'batchesProcessed', width: 180,
      render: (v: number, r: ActiveTask) => {
        const pct = r.totalBatches > 0 ? Math.round((v / r.totalBatches) * 100) : 0;
        return (
          <span>
            <Progress percent={pct} size="small" style={{ width: 80, display: 'inline-block' }} />
            <Text style={{ marginLeft: 8, fontSize: 12 }}>{v}/{r.totalBatches} 批</Text>
          </span>
        );
      },
    },
  ];

  const healthy = queue.stuck === 0 && queue.failed < queue.total * 0.1;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <DashboardOutlined style={{ marginRight: 8, color: '#0fc6c2' }} />
              监控面板
            </Title>
            <Text type="secondary">Worker 队列、活跃任务、系统健康状态</Text>
          </div>
          <Space>
            <Button icon={<InboxOutlined />} onClick={() => router.push('/')}>返回导入</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>刷新</Button>
          </Space>
        </div>

        {/* 系统健康状态 */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space>
            <Tag icon={healthy ? <CheckCircleOutlined /> : <WarningOutlined />}
              color={healthy ? 'success' : 'warning'} style={{ fontSize: 14, padding: '4px 12px' }}>
              {healthy ? '系统正常' : '需要关注'}
            </Tag>
            <Text type="secondary">最后更新: {lastUpdated}</Text>
            <Text type="secondary">| 队列总数: {queue.total}</Text>
          </Space>
        </Card>

        <Row gutter={16} style={{ marginBottom: 16 }}>
          {/* Outbox 队列状态 */}
          <Col span={12}>
            <Card title={<><ThunderboltOutlined /> Outbox 队列</>} size="small">
              {queue.total === 0 && !loading ? (
                <Empty description="暂无排队事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Table
                  columns={queueColumns}
                  dataSource={queueData}
                  pagination={false}
                  size="small"
                  showHeader={false}
                  rowKey="key"
                />
              )}
            </Card>
          </Col>

          {/* 统计 */}
          <Col span={12}>
            <Card title="队列统计" size="small">
              <Row gutter={[8, 16]}>
                <Col span={8}><Statistic title="待处理" value={queue.pending} valueStyle={{ color: '#1677ff' }} /></Col>
                <Col span={8}><Statistic title="执行中" value={queue.sent} valueStyle={{ color: '#faad14' }} /></Col>
                <Col span={8}><Statistic title="卡住" value={queue.stuck} valueStyle={{ color: queue.stuck > 0 ? '#ff4d4f' : '#52c41a' }} /></Col>
                <Col span={8}><Statistic title="成功" value={queue.succeeded} valueStyle={{ color: '#52c41a' }} /></Col>
                <Col span={8}><Statistic title="失败" value={queue.failed} valueStyle={{ color: '#ff4d4f' }} /></Col>
                <Col span={8}><Statistic title="总计" value={queue.total} /></Col>
              </Row>
            </Card>
          </Col>
        </Row>

        {/* 活跃任务 */}
        <Card
          title={<><SyncOutlined spin={activeTasks.length > 0} /> 活跃 Worker 任务 ({activeTasks.length})</>}
          size="small"
        >
          {activeTasks.length === 0 ? (
            <Empty description="暂无活跃任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table
              columns={activeColumns}
              dataSource={activeTasks}
              rowKey="taskId"
              size="small"
              pagination={false}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

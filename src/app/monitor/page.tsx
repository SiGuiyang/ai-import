'use client';

/**
 * 导入监控看板
 *
 * 4 个核心区域：
 * 1. 实时吞吐量
 * 2. 队列积压深度
 * 3. 阶段耗时分布
 * 4. 错误类型分布
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Row, Col, Table, Tag, Statistic, Alert, Spin, Button, Space } from 'antd';
import { WarningOutlined, ReloadOutlined } from '@ant-design/icons';

const QUEUE_ALERT_THRESHOLD = 5000;

export default function MonitorPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/import-monitor/summary');
      const json = await res.json();
      if (json.code === 0) setData(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 3000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading && !data) {
    return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (!data) {
    return <div style={{ padding: 40, textAlign: 'center' }}>暂无数据</div>;
  }

  const queueAlert = data.queueDepth > QUEUE_ALERT_THRESHOLD;
  const queueCritical = data.queueDepth === -1; // DB unavailable

  const stageColumns = [
    { title: '阶段', dataIndex: 'stage', width: 100 },
    {
      title: 'P50', dataIndex: 'p50', width: 80,
      render: (v: number) => `${v}ms`,
    },
    {
      title: 'P95', dataIndex: 'p95', width: 80,
      render: (v: number) => <span style={{ color: v > 500 ? '#ff4d4f' : undefined }}>{v}ms</span>,
    },
    {
      title: 'P99', dataIndex: 'p99', width: 80,
      render: (v: number) => <span style={{ color: v > 1000 ? '#ff4d4f' : undefined }}>{v}ms</span>,
    },
  ];

  const errorColumns = [
    { title: '错误码', dataIndex: 'errorCode', width: 80, render: (v: string) => <Tag color="red">{v}</Tag> },
    { title: '错误类型', dataIndex: 'errorName' },
    { title: '数量', dataIndex: 'count', width: 80 },
  ];

  const slowBatchColumns = [
    { title: '任务ID', dataIndex: 'taskId', width: 140, render: (v: string) => <a onClick={() => router.push(`/import-tasks/${v}`)} style={{ fontSize: 11 }}>{v}</a> },
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    { title: '解析', dataIndex: 'parseMs', width: 60, render: (v: number) => `${v}ms` },
    { title: '规则', dataIndex: 'ruleMs', width: 60, render: (v: number) => `${v}ms` },
    { title: '校验', dataIndex: 'validateMs', width: 60, render: (v: number) => `${v}ms` },
    { title: '写入', dataIndex: 'insertMs', width: 60, render: (v: number) => `${v}ms` },
    { title: '总耗时', dataIndex: 'totalMs', width: 80, render: (v: number) => <Tag color="orange">{v}ms</Tag> },
  ];

  const recentTaskColumns = [
    { title: '任务ID', dataIndex: 'taskId', width: 140, render: (v: string) => <a onClick={() => router.push(`/import-tasks/${v}`)} style={{ fontSize: 11 }}>{v}</a> },
    { title: '文件名', dataIndex: 'fileName', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          PENDING: { color: 'default', text: '等待' }, PROCESSING: { color: 'processing', text: '处理中' },
          COMPLETED: { color: 'success', text: '完成' }, PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' }, FAILED: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '成功/失败', render: (_: any, r: any) => `${r.successRows}/${r.failedRows}`, width: 80 },
  ];

  // 渲染简化的吞吐量柱状图
  const maxThroughput = data.throughput && data.throughput.length > 0
    ? Math.max(...data.throughput.map((t: any) => t.rows), 1)
    : 1;

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>导入监控看板</h2>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </div>

      {/* 告警区域 */}
      {queueAlert && (
        <Alert
          message={`队列积压告警：${data.queueDepth} 条事件等待处理中`}
          type="warning"
          icon={<WarningOutlined />}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}
      {queueCritical && (
        <Alert message="队列不可用：无法连接到数据库" type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {/* 顶部概览卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="队列积压"
              value={data.queueDepth}
              valueStyle={{ color: queueAlert ? '#faad14' : '#3f8600' }}
              suffix={queueAlert ? <WarningOutlined /> : ' 条'}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="最近任务数" value={data.recentTasks?.length || 0} suffix="个" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="错误类型数" value={data.errorDistribution?.length || 0} suffix="种" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="慢批次" value={data.slowBatches?.length || 0} suffix="个 (TOP10)" />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 实时吞吐量 */}
        <Col span={12}>
          <Card title="实时吞吐量 (行/分钟)" size="small" style={{ marginBottom: 16 }}>
            {data.throughput && data.throughput.length > 0 ? (
              <div>
                {data.throughput.map((t: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ width: 100, fontSize: 11, color: '#888' }}>
                      {new Date(t.minute).toLocaleTimeString()}
                    </span>
                    <div style={{
                      flex: 1, height: 20, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%', background: '#1677ff', borderRadius: 4,
                        width: `${(t.rows / maxThroughput) * 100}%`,
                        minWidth: t.rows > 0 ? 4 : 0,
                        display: 'flex', alignItems: 'center', paddingLeft: 8,
                      }}>
                        <span style={{ color: '#fff', fontSize: 11 }}>{t.rows}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#888', textAlign: 'center', padding: 20 }}>暂无数据</div>
            )}
          </Card>
        </Col>

        {/* 阶段耗时分布 */}
        <Col span={12}>
          <Card title="阶段耗时分布 (最近1小时)" size="small" style={{ marginBottom: 16 }}>
            <Table columns={stageColumns} dataSource={data.stageDistribution || []} rowKey="stage" size="small" pagination={false} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 错误类型分布 */}
        <Col span={12}>
          <Card title="错误类型分布 (最近1小时)" size="small" style={{ marginBottom: 16 }}>
            <Table
              columns={errorColumns}
              dataSource={data.errorDistribution || []}
              rowKey="errorCode"
              size="small"
              pagination={false}
              onRow={(record) => ({
                onClick: () => router.push(`/import-tasks?errorCode=${record.errorCode}`),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>
        </Col>

        {/* 慢批次 TOP 10 */}
        <Col span={12}>
          <Card title="慢批次 TOP 10" size="small" style={{ marginBottom: 16 }}>
            <Table
              columns={slowBatchColumns}
              dataSource={data.slowBatches || []}
              rowKey={(r: any) => `${r.taskId}-${r.batchIndex}`}
              size="small"
              pagination={false}
            />
          </Card>
        </Col>
      </Row>

      {/* 最近任务 */}
      <Card title="最近导入任务" size="small">
        <Table
          columns={recentTaskColumns}
          dataSource={data.recentTasks || []}
          rowKey="taskId"
          size="small"
          pagination={false}
        />
      </Card>
    </div>
  );
}

'use client';

/**
 * 模块八：导入监控看板
 *
 * 核心区域：
 * 1. 实时吞吐量（最近 5 分钟柱状图）
 * 2. 队列积压深度（含行数告警）
 * 3. 阶段耗时分布（P50/P95/P99）
 * 4. 错误类型分布（可点击跳转）
 *
 * 加分项：
 * - 慢批次 TOP 10
 * - 失败任务趋势
 * - DB 连接状态 / Worker 并发
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, Row, Col, Table, Tag, Statistic, Alert, Progress, Tooltip, Space, Button, Typography, Spin,
} from 'antd';
import {
  ReloadOutlined, WarningOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, DashboardOutlined, BugOutlined, ClockCircleOutlined,
  ApiOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

const POLL_INTERVAL = 2000;

const STAGE_COLORS: Record<string, string> = {
  '文件解析': '#1677ff',
  '规则引擎': '#52c41a',
  '数据校验': '#faad14',
  '批量写入': '#722ed1',
  '总计': '#ff4d4f',
};

export default function MonitorPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/import-monitor/summary');
      const json = await res.json();
      if (json.code === 0) setData(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}><Spin size="large" /></div>;
  }

  const throughputData = data?.throughput || [];
  const maxThroughput = Math.max(...throughputData.map((t: any) => t.rows), 1);

  // 队列告警判断
  const queueAlert = data?.queueUnavailable
    ? 'error'
    : (data?.queueDepthRows || 0) > 5000
      ? 'warning'
      : undefined;

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      {/* 顶部状态栏 */}
      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col flex="auto">
          <Space size="large">
            <DashboardOutlined style={{ fontSize: 22, color: '#1677ff' }} />
            <Text strong style={{ fontSize: 18 }}>导入监控看板</Text>
            <Tag color={data?.dbConnected ? 'success' : 'error'} icon={data?.dbConnected ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
              {data?.dbConnected ? 'DB 正常' : 'DB 异常'}
            </Tag>
            <Tag color="processing">
              Workers: {data?.activeWorkerCount ?? 0} / {data?.maxWorkers ?? 5}
            </Tag>
          </Space>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={fetchData} size="small">
            刷新
          </Button>
        </Col>
      </Row>

      {/* ====== 第一行：核心指标 ====== */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          {/* 区域一：实时吞吐量 */}
          <Card
            title={<><ThunderboltOutlined /> 实时吞吐量（最近 5 分钟）</>}
            size="small"
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', height: 160, gap: 12, padding: '0 8px' }}>
              {throughputData.map((item: any, idx: number) => {
                const height = maxThroughput > 0 ? (item.rows / maxThroughput) * 140 : 0;
                return (
                  <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, fontWeight: 500 }}>{item.minute?.slice(11, 16) || '-'}</Text>
                    <Tooltip title={`${item.rows} 行`}>
                      <div
                        style={{
                          width: '100%',
                          height: Math.max(height, 3),
                          backgroundColor: height > 0 ? '#1677ff' : '#f0f0f0',
                          borderRadius: '4px 4px 0 0',
                          transition: 'height 0.3s ease',
                          minWidth: 20,
                        }}
                      />
                    </Tooltip>
                    <Text style={{ fontSize: 10, color: '#999' }}>{item.rows}</Text>
                  </div>
                );
              })}
              {throughputData.length === 0 && (
                <div style={{ flex: 1, textAlign: 'center', color: '#ccc', paddingTop: 60 }}>暂无数据</div>
              )}
            </div>
          </Card>
        </Col>

        <Col span={12}>
          {/* 区域二：队列积压深度 */}
          <Card
            title={
              <Space>
                <ApiOutlined />
                队列积压深度
                {queueAlert === 'error' && <Tag color="red" icon={<CloseCircleOutlined />}>队列不可用</Tag>}
                {queueAlert === 'warning' && <Tag color="orange" icon={<WarningOutlined />}>积压告警</Tag>}
              </Space>
            }
            size="small"
          >
            <Alert
              type={queueAlert || 'info'}
              showIcon
              message={
                queueAlert === 'error'
                  ? '队列服务不可用，请检查 Redis 连接或数据库状态'
                  : queueAlert === 'warning'
                    ? `待处理积压超过 5,000 行，当前 ${(data?.queueDepthRows || 0).toLocaleString()} 行`
                    : `队列正常，待处理 ${(data?.queueDepthRows || 0).toLocaleString()} 行（${data?.queueDepth || 0} 个批次事件）`
              }
              style={{ marginBottom: 12 }}
            />

            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="待处理批次事件" value={data?.queueDepth ?? 0} suffix="个" />
              </Col>
              <Col span={8}>
                <Statistic
                  title="待处理行数"
                  value={data?.queueDepthRows ?? 0}
                  valueStyle={{ color: queueAlert ? '#faad14' : undefined }}
                />
              </Col>
              <Col span={8}>
                <Statistic title="活跃任务数" value={data?.activeTasks ?? 0} suffix={`/ ${data?.maxWorkers ?? 5}`} />
              </Col>
            </Row>

            {/* 积压进度条 */}
            <div style={{ marginTop: 12 }}>
              <Progress
                percent={data?.queueDepthRows > 0 ? Math.min((data.queueDepthRows / 5000) * 100, 100) : 0}
                strokeColor={queueAlert === 'error' ? '#ff4d4f' : queueAlert === 'warning' ? '#faad14' : '#52c41a'}
                format={() => `${(data?.queueDepthRows || 0).toLocaleString()} 行`}
              />
            </div>
          </Card>
        </Col>
      </Row>

      {/* ====== 第二行：阶段耗时 + 错误分布 ====== */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          {/* 区域三：阶段耗时分布 */}
          <Card title={<><ClockCircleOutlined /> 阶段耗时分布（P50 / P95 / P99）</>} size="small">
            <Table
              dataSource={data?.stageDistribution || []}
              rowKey="stage"
              pagination={false}
              size="small"
              columns={[
                {
                  title: '阶段', dataIndex: 'stage', width: 90,
                  render: (v: string) => <Tag color={STAGE_COLORS[v] || 'default'}>{v}</Tag>,
                },
                {
                  title: 'P50', dataIndex: 'p50', width: 80, align: 'right',
                  render: (v: number) => <Text strong>{v}ms</Text>,
                },
                {
                  title: 'P95', dataIndex: 'p95', width: 80, align: 'right',
                  render: (v: number) => <Text style={{ color: v > 1000 ? '#ff4d4f' : undefined }}>{v}ms</Text>,
                },
                {
                  title: 'P99', dataIndex: 'p99', width: 80, align: 'right',
                  render: (v: number) => <Text style={{ color: v > 2000 ? '#ff4d4f' : undefined }}>{v}ms</Text>,
                },
                {
                  title: '耗时占比', width: 120,
                  render: (_: any, r: any) => {
                    const max = Math.max(...(data?.stageDistribution || []).map((s: any) => s.p50), 1);
                    return <Progress percent={(r.p50 / max) * 100} showInfo={false} strokeColor={STAGE_COLORS[r.stage]} size="small" />;
                  },
                },
              ]}
            />
          </Card>
        </Col>

        <Col span={12}>
          {/* 区域四：错误类型分布 */}
          <Card
            title={<><BugOutlined /> 错误类型分布（最近 1 小时）</>}
            size="small"
            extra={
              <Button type="link" size="small" onClick={() => router.push('/import-tasks')}>
                查看所有
              </Button>
            }
          >
            {(data?.errorDistribution || []).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#52c41a', padding: 40 }}>暂无错误</div>
            ) : (
              <Table
                dataSource={data?.errorDistribution || []}
                rowKey="errorCode"
                pagination={false}
                size="small"
                onRow={(record: any) => ({
                  style: { cursor: 'pointer' },
                  onClick: () => router.push(`/import-tasks?errorCode=${record.errorCode}`),
                })}
                columns={[
                  {
                    title: '错误码', dataIndex: 'errorCode', width: 80,
                    render: (v: string) => <Tag color="orange">{v}</Tag>,
                  },
                  { title: '类型', dataIndex: 'errorName', ellipsis: true },
                  {
                    title: '次数', dataIndex: 'count', width: 60, align: 'right',
                    render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v}</Text>,
                  },
                  {
                    title: '占比', width: 100,
                    render: (_: any, r: any) => {
                      const total = (data?.errorDistribution || []).reduce((s: number, e: any) => s + e.count, 0);
                      const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
                      return <Progress percent={pct} size="small" strokeColor={pct > 30 ? '#ff4d4f' : '#faad14'} />;
                    },
                  },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* ====== 第三行：慢批次 TOP 10 + 失败任务趋势 ====== */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="慢批次 TOP 10" size="small">
            <Table
              dataSource={data?.slowBatches || []}
              rowKey={(r: any) => `${r.taskId}-${r.unitId}`}
              pagination={false}
              size="small"
              columns={[
                {
                  title: '任务/批次', width: 160,
                  render: (_: any, r: any) => (
                    <Space direction="vertical" size={0}>
                      <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.taskId?.slice(0, 12)}...</Text>
                      <Text type="secondary" style={{ fontSize: 10 }}>批次 {r.batchIndex}</Text>
                    </Space>
                  ),
                },
                {
                  title: '解析', dataIndex: 'parseMs', width: 60, align: 'right',
                  render: (v: number) => `${v}ms`,
                },
                {
                  title: '规则', dataIndex: 'ruleMs', width: 60, align: 'right',
                  render: (v: number) => `${v}ms`,
                },
                {
                  title: '校验', dataIndex: 'validateMs', width: 60, align: 'right',
                  render: (v: number) => `${v}ms`,
                },
                {
                  title: '写入', dataIndex: 'insertMs', width: 60, align: 'right',
                  render: (v: number) => `${v}ms`,
                },
                {
                  title: '总耗时', dataIndex: 'totalMs', width: 80, align: 'right',
                  render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v}ms</Text>,
                },
                {
                  title: '状态', dataIndex: 'status', width: 70,
                  render: (v: string) => {
                    const m: Record<string, { color: string; text: string }> = {
                      SUCCEEDED: { color: 'success', text: '成功' },
                      FAILED: { color: 'error', text: '失败' },
                      PARTIAL: { color: 'warning', text: '部分' },
                    };
                    const info = m[v] || { color: 'default', text: v || '-' };
                    return <Tag color={info.color}>{info.text}</Tag>;
                  },
                },
              ]}
            />
          </Card>
        </Col>

        <Col span={12}>
          <Card title="失败任务趋势（最近 24 小时）" size="small">
            {(data?.failedTaskTrends || []).length === 0 ? (
              <div style={{ textAlign: 'center', color: '#52c41a', padding: 40 }}>
                <CheckCircleOutlined style={{ fontSize: 28 }} />
                <Paragraph type="success" style={{ marginTop: 8 }}>最近 24 小时无失败任务</Paragraph>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', height: 200, gap: 4, padding: '0 4px' }}>
                {(data?.failedTaskTrends || []).map((item: any, idx: number) => {
                  const maxFail = Math.max(...(data?.failedTaskTrends || []).map((t: any) => t.failedCount || 0), 1);
                  const height = ((item.failedCount || 0) / maxFail) * 180;
                  return (
                    <Tooltip
                      key={idx}
                      title={`${item.hour?.slice(11, 16)} — 失败 ${item.failedCount} 个任务，${item.errorCount} 行错误`}
                    >
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 200 }}>
                        <div
                          style={{
                            width: '100%',
                            height: Math.max(height, 3),
                            backgroundColor: item.failedCount > 0 ? '#ff4d4f' : '#f0f0f0',
                            borderRadius: '3px 3px 0 0',
                            minWidth: 16,
                          }}
                        />
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ====== 第四行：最近任务 ====== */}
      <Card title="最近导入任务" size="small"
        extra={
          <Button type="link" size="small" onClick={() => router.push('/import-tasks')}>查看全部</Button>
        }
      >
        <Table
          dataSource={data?.recentTasks || []}
          rowKey="taskId"
          pagination={false}
          size="small"
          columns={[
            {
              title: '任务ID', dataIndex: 'taskId', width: 140,
              render: (v: string) => (
                <a onClick={() => router.push(`/import-tasks/${v}`)} style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {v.slice(0, 14)}...
                </a>
              ),
            },
            { title: '文件名', dataIndex: 'fileName', ellipsis: true },
            {
              title: '状态', dataIndex: 'status', width: 90,
              render: (v: string) => {
                const m: Record<string, { color: string; text: string }> = {
                  PENDING: { color: 'default', text: '等待' }, PROCESSING: { color: 'processing', text: '处理中' },
                  COMPLETED: { color: 'success', text: '完成' }, PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
                  FAILED: { color: 'error', text: '失败' },
                };
                const info = m[v] || { color: 'default', text: v };
                return <Tag color={info.color}>{info.text}</Tag>;
              },
            },
            { title: '总行', dataIndex: 'totalRows', width: 60 },
            {
              title: '成功/失败', width: 90,
              render: (_: any, r: any) => (
                <span>
                  <Text style={{ color: '#52c41a' }}>{r.successRows}</Text>
                  {' / '}
                  <Text style={{ color: r.failedRows > 0 ? '#ff4d4f' : undefined }}>{r.failedRows}</Text>
                </span>
              ),
            },
            { title: '进度', width: 100, render: (_: any, r: any) => (
              <Progress percent={r.totalRows > 0 ? Math.round((r.processedRows / r.totalRows) * 100) : 0} size="small" />
            )},
            {
              title: '降级', dataIndex: 'degraded', width: 60,
              render: (v: boolean) => v ? <Tag color="orange" icon={<WarningOutlined />}>降级</Tag> : null,
            },
            {
              title: '时间', dataIndex: 'createdAt', width: 120,
              render: (v: string) => v ? new Date(v).toLocaleString() : '-',
            },
          ]}
        />
      </Card>
    </div>
  );
}

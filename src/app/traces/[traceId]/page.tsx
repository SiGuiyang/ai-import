'use client';

/**
 * 模块九：全链路 Trace 时间线详情页
 *
 * 功能：
 * - 按 trace_id 查看完整时间线
 * - 支持按批次、错误码、行号范围筛选
 * - 点击失败节点 → 弹窗展示完整错误上下文
 * - 批次性能表格
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card, Table, Tag, Button, Space, Spin, Timeline, Descriptions, Input, Select, Row, Col,
  Modal, Typography, Tooltip, Segmented,
} from 'antd';
import {
  ArrowLeftOutlined, SearchOutlined, BugOutlined, EyeOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { ERROR_CODES, SUGGESTED_FIXES } from '@/lib/types';

const { Text, Paragraph } = Typography;

const STATUS_COLOR_MAP: Record<string, string> = {
  STARTED: '#1677ff',
  SUCCEEDED: '#52c41a',
  FAILED: '#ff4d4f',
};

export default function TraceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const traceId = params.traceId as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [searchTraceId, setSearchTraceId] = useState(traceId || '');
  const [searchErrorCode, setSearchErrorCode] = useState('');
  const [searchBatch, setSearchBatch] = useState('');
  const [searchRowFrom, setSearchRowFrom] = useState('');
  const [searchRowTo, setSearchRowTo] = useState('');

  // 错误详情 Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedError, setSelectedError] = useState<any>(null);

  // 视图模式：时间线 / 批次列表
  const [viewMode, setViewMode] = useState<'timeline' | 'batches'>('timeline');
  // 展开的批次（批次列表视图）
  const [expandedBatch, setExpandedBatch] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    if (!searchTraceId) return;
    try {
      let url = `/api/traces/${searchTraceId}`;
      const queryParams: string[] = [];
      if (searchErrorCode) queryParams.push(`errorCode=${searchErrorCode}`);
      if (searchBatch) queryParams.push(`batch=${searchBatch}`);
      if (searchRowFrom) queryParams.push(`rowFrom=${searchRowFrom}`);
      if (searchRowTo) queryParams.push(`rowTo=${searchRowTo}`);
      if (queryParams.length > 0) url += '?' + queryParams.join('&');

      const res = await fetch(url);
      const json = await res.json();
      if (json.code === 0) setData(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [searchTraceId, searchErrorCode, searchBatch, searchRowFrom, searchRowTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    if (searchTraceId !== traceId) {
      router.push(`/traces/${searchTraceId}`);
    } else {
      fetchData();
    }
  };

  const handleErrorClick = (error: any) => {
    // 构建完整错误详情：
    // 查找对应批次的性能数据
    const batchPerf = (data?.batches || []).find((b: any) => b.batchIndex === error.batchIndex);
    setSelectedError({
      ...error,
      ruleName: data?.task?.ruleName || null,
      stageDurations: batchPerf
        ? {
            parseMs: batchPerf.parseMs,
            ruleMs: batchPerf.ruleMs,
            validateMs: batchPerf.validateMs,
            insertMs: batchPerf.insertMs,
            totalMs: batchPerf.totalMs,
          }
        : null,
    });
    setModalVisible(true);
  };

  if (loading) {
    return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/traces')}>返回搜索</Button>
        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无数据</div>
      </div>
    );
  }

  // ========== 构建带上下文的时间线 ==========
  const timeline = data.timeline || [];
  const errorsByBatch = data.errorsByBatch || {};
  const batches = data.batches || [];

  const timelineWithContext = timeline.map((e: any) => {
    // 查找是否关联了批次
    const unitId = e.unitId;
    const batch = batches.find((b: any) => b.unitId === unitId);
    const batchErrors = batch ? (errorsByBatch[batch.batchIndex] || []) : [];
    const isFailed = e.eventStatus === 'FAILED';

    return { ...e, batch, batchErrors, isFailed, hasError: batchErrors.length > 0 };
  });

  const errorColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 55 },
    { title: '行号', dataIndex: 'rowNumber', width: 60 },
    { title: '字段', dataIndex: 'fieldName', width: 100, ellipsis: true },
    {
      title: '错误码', dataIndex: 'errorCode', width: 70,
      render: (v: string) => <Tag color="red" style={{ cursor: 'pointer' }}>{v}</Tag>,
    },
    { title: '错误类型', dataIndex: 'errorName', width: 100, ellipsis: true },
    { title: '原因', dataIndex: 'errorReason', ellipsis: true },
    {
      title: '原始值', dataIndex: 'rawValueMasked', width: 130, ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作', width: 60, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleErrorClick(r)}>
          详情
        </Button>
      ),
    },
  ];

  const batchColumns = [
    {
      title: '批次', dataIndex: 'batchIndex', width: 55,
      render: (v: number, r: any) => (
        <a onClick={() => {
          setExpandedBatch(expandedBatch === v ? null : v);
        }}>#{v}</a>
      ),
    },
    { title: '行范围', render: (_: any, r: any) => r.startRow != null ? `${r.startRow} - ${r.endRow}` : '-', width: 90 },
    {
      title: '状态', dataIndex: 'status', width: 80,
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
    {
      title: '错误', render: (_: any, r: any) => {
        const cnt = (errorsByBatch[r.batchIndex] || []).length;
        return cnt > 0 ? <Tag color="red">{cnt}</Tag> : <Text type="secondary">0</Text>;
      }, width: 60,
    },
    { title: '解析', render: (_: any, r: any) => `${r.parseMs}ms`, width: 70 },
    { title: '规则', render: (_: any, r: any) => `${r.ruleMs}ms`, width: 70 },
    { title: '校验', render: (_: any, r: any) => `${r.validateMs}ms`, width: 70 },
    { title: '写入', render: (_: any, r: any) => `${r.insertMs}ms`, width: 70 },
    {
      title: '总耗时', render: (_: any, r: any) => {
        const color = r.totalMs > 5000 ? '#ff4d4f' : r.totalMs > 2000 ? '#faad14' : '#1890ff';
        return <Tag color={color}>{r.totalMs}ms</Tag>;
      }, width: 80,
    },
    {
      title: '重试', dataIndex: 'retryCount', width: 55,
      render: (v: number) => v > 0 ? <Tag color="orange">{v}</Tag> : null,
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      {/* 导航 */}
      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/traces')}>返回搜索</Button>
        </Col>
        <Col>
          <Text strong style={{ fontSize: 18 }}>全链路 Trace 详情</Text>
        </Col>
        <Col>
          <Text type="secondary" code style={{ fontSize: 12 }}>{traceId}</Text>
        </Col>
      </Row>

      {/* 搜索区域 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle">
          <Col flex="auto">
            <Input.Search
              placeholder="输入 Trace ID 或 Task ID 搜索"
              value={searchTraceId}
              onChange={(e) => setSearchTraceId(e.target.value)}
              onSearch={handleSearch}
              enterButton={<><SearchOutlined /> 搜索</>}
            />
          </Col>
          <Col>
            <Select
              placeholder="错误类型"
              allowClear style={{ width: 150 }}
              value={searchErrorCode || undefined}
              onChange={setSearchErrorCode}
              options={Object.entries(ERROR_CODES).map(([k, v]) => ({ label: v, value: k }))}
            />
          </Col>
          <Col>
            <Input
              placeholder="批次号" style={{ width: 90 }} type="number"
              value={searchBatch} onChange={(e) => setSearchBatch(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col>
            <Input
              placeholder="行号起" style={{ width: 80 }} type="number"
              value={searchRowFrom} onChange={(e) => setSearchRowFrom(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col>
            <Input
              placeholder="行号止" style={{ width: 80 }} type="number"
              value={searchRowTo} onChange={(e) => setSearchRowTo(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          </Col>
        </Row>
      </Card>

      {/* 概览 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={18}>
          <Card size="small">
            <Descriptions column={3} size="small">
              <Descriptions.Item label="Trace ID">
                <Text code style={{ fontSize: 11 }}>{data.traceId}</Text>
              </Descriptions.Item>
              {data.task && (
                <>
                  <Descriptions.Item label="任务ID">
                    <a onClick={() => router.push(`/import-tasks/${data.task.taskId}`)}>
                      <Text code style={{ fontSize: 11 }}>{data.task.taskId}</Text>
                    </a>
                  </Descriptions.Item>
                  <Descriptions.Item label="文件名">{data.task.fileName}</Descriptions.Item>
                  <Descriptions.Item label="规则">
                    {data.task.ruleName ? <Tag color="blue">{data.task.ruleName}</Tag> : '-'}
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={data.task.status === 'COMPLETED' ? 'success' : data.task.status === 'FAILED' ? 'error' : 'processing'}>
                      {data.task.status}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="总行数">{data.task.totalRows}</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="事件数">{data.summary.totalEvents}</Descriptions.Item>
              <Descriptions.Item label="错误数">
                <span style={{ color: data.summary.totalErrors > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 500 }}>
                  {data.summary.totalErrors}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="批次数">{data.summary.totalBatches}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1677ff' }}>{data.summary.totalEvents}</div>
              <Text type="secondary">时间线事件</Text>
              <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700, color: data.summary.totalErrors > 0 ? '#ff4d4f' : '#52c41a' }}>
                {data.summary.totalErrors}
              </div>
              <Text type="secondary">错误明细</Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 主区域：时间线 + 批次性能 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card
            title="事件时间线"
            size="small"
            extra={
              <Segmented
                size="small"
                value={viewMode}
                onChange={(v) => setViewMode(v as 'timeline' | 'batches')}
                options={[
                  { label: '时间线', value: 'timeline' },
                  { label: '按批次', value: 'batches' },
                ]}
              />
            }
            style={{ marginBottom: 16 }}
          >
            {viewMode === 'timeline' ? (
              <Timeline
                items={timelineWithContext.map((e: any) => ({
                  color: STATUS_COLOR_MAP[e.eventStatus] || '#999',
                  dot: e.isFailed ? <CloseCircleOutlined style={{ fontSize: 16 }} /> : undefined,
                  children: (
                    <div
                      style={{
                        cursor: e.hasError || e.isFailed ? 'pointer' : 'default',
                        padding: '4px 8px',
                        borderRadius: 6,
                        background: e.isFailed ? '#fff2f0' : e.hasError ? '#fffbe6' : 'transparent',
                        border: e.isFailed ? '1px solid #ffccc7' : e.hasError ? '1px solid #ffe58f' : '1px solid transparent',
                      }}
                      onClick={() => {
                        if (e.batchErrors.length > 0) {
                          handleErrorClick(e.batchErrors[0]);
                        }
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: 13 }}>
                        {e.eventName}
                        {e.batch && (
                          <Tag style={{ marginLeft: 6 }} color="blue">批次 #{e.batch.batchIndex}</Tag>
                        )}
                        {e.isFailed && <Tag color="red">失败</Tag>}
                        {e.hasError && !e.isFailed && (
                          <Tag color="orange" icon={<BugOutlined />}>{e.batchErrors.length} 个错误</Tag>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                        {new Date(e.occurredAt).toLocaleTimeString()}
                        {e.message && <span> — {e.message}</span>}
                      </div>
                      {e.hasError && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            点击查看错误详情
                          </Text>
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            ) : (
              /* 按批次视图 */
              <div>
                {batches.map((b: any) => {
                  const batchErrors = errorsByBatch[b.batchIndex] || [];
                  const isExpanded = expandedBatch === b.batchIndex;
                  const batchEvent = timeline.find((e: any) => e.unitId === b.unitId);
                  return (
                    <Card
                      key={b.batchIndex}
                      size="small"
                      style={{ marginBottom: 8 }}
                      type={batchErrors.length > 0 ? undefined : 'default'}
                      styles={batchErrors.length > 0 ? { body: { borderLeft: '3px solid #faad14' } } : {}}
                    >
                      <Row justify="space-between" align="middle">
                        <Col>
                          <Tag color="blue">批次 #{b.batchIndex}</Tag>
                          {b.startRow != null && (
                            <Text type="secondary" style={{ fontSize: 12 }}>行 {b.startRow} - {b.endRow}</Text>
                          )}
                          <Tag style={{ marginLeft: 8 }} color={b.status === 'SUCCEEDED' ? 'success' : b.status === 'FAILED' ? 'error' : 'default'}>
                            {b.status}
                          </Tag>
                          {b.retryCount > 0 && <Tag color="orange">重试 {b.retryCount}</Tag>}
                        </Col>
                        <Col>
                          <Space size="small">
                            <Text type="secondary" style={{ fontSize: 11 }}>解析 {b.parseMs}ms</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>规则 {b.ruleMs}ms</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>校验 {b.validateMs}ms</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>写入 {b.insertMs}ms</Text>
                            <Tag color={b.totalMs > 5000 ? 'red' : 'orange'}>{b.totalMs}ms</Tag>
                          </Space>
                        </Col>
                      </Row>
                      {batchErrors.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>{batchErrors.length} 个错误</Text>
                          {isExpanded && (
                            <Table
                              columns={errorColumns.filter(c => c.dataIndex !== 'batchIndex')}
                              dataSource={batchErrors}
                              rowKey="id"
                              size="small"
                              pagination={false}
                              scroll={{ x: 700 }}
                              style={{ marginTop: 8 }}
                            />
                          )}
                          {!isExpanded && (
                            <Button
                              type="link" size="small"
                              onClick={() => setExpandedBatch(b.batchIndex)}
                              style={{ padding: 0, marginLeft: 8 }}
                            >
                              展开
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
                {batches.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#ccc' }}>暂无批次数据</div>
                )}
              </div>
            )}
          </Card>
        </Col>

        <Col span={10}>
          {/* 批次性能表格 */}
          <Card title="批次性能" size="small" style={{ marginBottom: 16 }}>
            <Table
              columns={batchColumns}
              dataSource={batches}
              rowKey="batchIndex"
              size="small"
              pagination={false}
              scroll={{ x: 600 }}
              onRow={(r: any) => ({
                onClick: () => setExpandedBatch(expandedBatch === r.batchIndex ? null : r.batchIndex),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>
        </Col>
      </Row>

      {/* 错误明细表 */}
      <Card
        title={<><BugOutlined /> 错误明细（{data.errors?.length || 0} 条）</>}
        size="small"
      >
        <Table
          columns={errorColumns}
          dataSource={data.errors || []}
          rowKey="id"
          size="small"
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
          onRow={(r: any) => ({
            onClick: () => handleErrorClick(r),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* 错误详情 Modal */}
      <Modal
        title={
          <Space>
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
            错误详情
          </Space>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setModalVisible(false)}>关闭</Button>,
          selectedError?.taskId && (
            <Button
              key="task"
              type="primary"
              onClick={() => router.push(`/import-tasks/${selectedError.taskId}?errorCode=${selectedError.errorCode}&batch=${selectedError.batchIndex}`)}
            >
              查看任务详情
            </Button>
          ),
        ]}
        width={700}
      >
        {selectedError && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="批次号">
              <Tag color="blue">#{selectedError.batchIndex}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="行号">
              <Text strong>第 {selectedError.rowNumber} 行</Text>
            </Descriptions.Item>
            <Descriptions.Item label="字段名">
              <Text code>{selectedError.fieldName}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="错误码">
              <Tag color="red">{selectedError.errorCode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误类型" span={2}>
              <Text strong>{selectedError.errorName}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="错误原因" span={2}>
              <Text style={{ color: '#ff4d4f' }}>{selectedError.errorReason}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="原始值" span={2}>
              <Paragraph
                copyable
                style={{ fontFamily: 'monospace', marginBottom: 0 }}
              >
                {selectedError.rawValueMasked}
              </Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="所属规则">
              {selectedError.ruleName ? <Tag color="blue">{selectedError.ruleName}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="是否已重试">
              {selectedError.retried
                ? <Tag color="orange">是（{selectedError.retryCount} 次）</Tag>
                : <Tag color="default">否</Tag>
              }
            </Descriptions.Item>

            {/* 阶段耗时 */}
            {selectedError.stageDurations && (
              <>
                <Descriptions.Item label="解析耗时">{selectedError.stageDurations.parseMs}ms</Descriptions.Item>
                <Descriptions.Item label="规则耗时">{selectedError.stageDurations.ruleMs}ms</Descriptions.Item>
                <Descriptions.Item label="校验耗时">{selectedError.stageDurations.validateMs}ms</Descriptions.Item>
                <Descriptions.Item label="写入耗时">{selectedError.stageDurations.insertMs}ms</Descriptions.Item>
                <Descriptions.Item label="总耗时" span={2}>
                  <Tag color={selectedError.stageDurations.totalMs > 5000 ? 'red' : 'orange'}>
                    {selectedError.stageDurations.totalMs}ms
                  </Tag>
                </Descriptions.Item>
              </>
            )}

            {/* 修复建议 */}
            <Descriptions.Item label="修复建议" span={2}>
              <div style={{ background: '#fffbe6', padding: '8px 12px', borderRadius: 6, borderLeft: '3px solid #faad14' }}>
                <Text>{selectedError.suggestedFix}</Text>
              </div>
            </Descriptions.Item>

            <Descriptions.Item label="Trace ID" span={2}>
              <Text code style={{ fontSize: 11 }} copyable>{selectedError.traceId}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="时间">
              {selectedError.createdAt ? new Date(selectedError.createdAt).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

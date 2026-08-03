'use client';

/**
 * 全链路 Trace 时间线查看页
 * 支持按 task_id、traceId、文件名、批次号、行号、错误码搜索
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Table, Tag, Button, Space, Spin, Timeline, Descriptions, Input, Select, Row, Col } from 'antd';
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons';
import { ERROR_CODES } from '@/lib/types';

export default function TraceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const traceId = params.traceId as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 搜索条件
  const [searchTraceId, setSearchTraceId] = useState(traceId || '');
  const [searchErrorCode, setSearchErrorCode] = useState('');
  const [searchBatch, setSearchBatch] = useState('');

  const fetchData = useCallback(async () => {
    if (!searchTraceId) return;
    try {
      let url = `/api/traces/${searchTraceId}`;
      const queryParams: string[] = [];
      if (searchErrorCode) queryParams.push(`errorCode=${searchErrorCode}`);
      if (searchBatch) queryParams.push(`batch=${searchBatch}`);
      if (queryParams.length > 0) url += '?' + queryParams.join('&');

      const res = await fetch(url);
      const json = await res.json();
      if (json.code === 0) setData(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [searchTraceId, searchErrorCode, searchBatch]);

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

  if (loading) {
    return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;
  }

  if (!data) {
    return (
      <div style={{ padding: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()}>返回</Button>
        <div style={{ textAlign: 'center', padding: 40 }}>暂无数据</div>
      </div>
    );
  }

  const statusColorMap: Record<string, string> = {
    STARTED: 'blue',
    SUCCEEDED: 'green',
    FAILED: 'red',
  };

  const errorColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    { title: '行号', dataIndex: 'rowNumber', width: 70 },
    { title: '字段', dataIndex: 'fieldName', width: 120 },
    {
      title: '错误码', dataIndex: 'errorCode', width: 80,
      render: (v: string) => <Tag color="red">{v}</Tag>,
    },
    { title: '错误类型', dataIndex: 'errorName', width: 120 },
    { title: '原因', dataIndex: 'errorReason', ellipsis: true },
    { title: '原始值', dataIndex: 'rawValue', width: 140, ellipsis: true },
  ];

  const batchColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          SUCCEEDED: { color: 'success', text: '成功' }, FAILED: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '解析', render: (_: any, r: any) => `${r.parseMs}ms`, width: 70 },
    { title: '规则', render: (_: any, r: any) => `${r.ruleMs}ms`, width: 70 },
    { title: '校验', render: (_: any, r: any) => `${r.validateMs}ms`, width: 70 },
    { title: '写入', render: (_: any, r: any) => `${r.insertMs}ms`, width: 70 },
    { title: '总耗时', render: (_: any, r: any) => <Tag color="orange">{r.totalMs}ms</Tag>, width: 80 },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/monitor')}>
          返回监控
        </Button>
      </div>

      {/* 搜索区域 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={12} align="middle">
          <Col flex="auto">
            <Input.Search
              placeholder="输入 Trace ID 或 Task ID 搜索"
              value={searchTraceId}
              onChange={(e) => setSearchTraceId(e.target.value)}
              onSearch={handleSearch}
              enterButton={<><SearchOutlined /> 搜索</>}
              size="middle"
            />
          </Col>
          <Col>
            <Select
              placeholder="错误类型筛选"
              allowClear
              style={{ width: 140 }}
              value={searchErrorCode || undefined}
              onChange={setSearchErrorCode}
              options={Object.entries(ERROR_CODES).map(([k, v]) => ({ label: v, value: k }))}
            />
          </Col>
          <Col>
            <Input
              placeholder="批次号"
              style={{ width: 100 }}
              value={searchBatch}
              onChange={(e) => setSearchBatch(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
        </Row>
      </Card>

      {/* 概览 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card size="small">
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Trace ID">{data.traceId}</Descriptions.Item>
              {data.task && (
                <>
                  <Descriptions.Item label="任务ID">
                    <a onClick={() => router.push(`/import-tasks/${data.task.taskId}`)}>{data.task.taskId}</a>
                  </Descriptions.Item>
                  <Descriptions.Item label="文件名">{data.task.fileName}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={data.task.status === 'COMPLETED' ? 'success' : 'processing'}>
                      {data.task.status}
                    </Tag>
                  </Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="事件数">{data.summary.totalEvents}</Descriptions.Item>
              <Descriptions.Item label="错误数">
                <span style={{ color: data.summary.totalErrors > 0 ? '#ff4d4f' : '#52c41a' }}>
                  {data.summary.totalErrors}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="统计">
            <div>事件: {data.summary.totalEvents}</div>
            <div>错误: {data.summary.totalErrors}</div>
            <div>批次: {data.summary.totalBatches}</div>
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* 时间线 */}
        <Col span={12}>
          <Card title="事件时间线" size="small" style={{ marginBottom: 16 }}>
            <Timeline
              items={(data.timeline || []).map((e: any) => ({
                color: statusColorMap[e.eventStatus] || 'gray',
                children: (
                  <div>
                    <div style={{ fontWeight: 500, marginBottom: 2 }}>{e.eventName}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>
                      {new Date(e.occurredAt).toLocaleTimeString()}
                      {e.message && <span> — {e.message}</span>}
                    </div>
                  </div>
                ),
              }))}
            />
          </Card>
        </Col>

        {/* 批次性能 */}
        <Col span={12}>
          <Card title="批次性能" size="small" style={{ marginBottom: 16 }}>
            <Table
              columns={batchColumns}
              dataSource={data.batches || []}
              rowKey="batchIndex"
              size="small"
              pagination={false}
            />
          </Card>
        </Col>
      </Row>

      {/* 错误明细 */}
      <Card title={`错误明细 (${data.errors?.length || 0}条)`} size="small">
        <Table
          columns={errorColumns}
          dataSource={data.errors || []}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20, showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>
    </div>
  );
}

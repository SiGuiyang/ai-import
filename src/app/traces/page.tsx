'use client';

/**
 * 模块九：全链路 Trace 检索页
 *
 * 支持按以下条件搜索：
 * - taskId
 * - 文件名（模糊匹配）
 * - 批次号
 * - 行号范围
 * - 错误码
 *
 * 搜索结果展示匹配的 Trace 列表，点击跳转到时间线详情。
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card, Table, Tag, Button, Row, Col, Input, Select, Space, Typography, Divider,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, ArrowLeftOutlined,
  FileTextOutlined, BugOutlined, DashboardOutlined,
} from '@ant-design/icons';
import { ERROR_CODES } from '@/lib/types';

const { Text } = Typography;

export default function TraceSearchPage() {
  const router = useRouter();

  const [taskId, setTaskId] = useState('');
  const [fileName, setFileName] = useState('');
  const [batchIndex, setBatchIndex] = useState('');
  const [rowFrom, setRowFrom] = useState('');
  const [rowTo, setRowTo] = useState('');
  const [errorCode, setErrorCode] = useState('');

  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const handleSearch = useCallback(async (p = 1) => {
    setLoading(true);
    setPage(p);
    try {
      const params = new URLSearchParams();
      if (taskId.trim()) params.set('taskId', taskId.trim());
      if (fileName.trim()) params.set('fileName', fileName.trim());
      if (batchIndex.trim()) params.set('batchIndex', batchIndex.trim());
      if (rowFrom.trim()) params.set('rowFrom', rowFrom.trim());
      if (rowTo.trim()) params.set('rowTo', rowTo.trim());
      if (errorCode) params.set('errorCode', errorCode);
      params.set('page', String(p));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`/api/traces/search?${params.toString()}`);
      const json = await res.json();
      if (json.code === 0) {
        setResults(json.data.items || []);
        setTotal(json.data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [taskId, fileName, batchIndex, rowFrom, rowTo, errorCode]);

  const handleReset = () => {
    setTaskId('');
    setFileName('');
    setBatchIndex('');
    setRowFrom('');
    setRowTo('');
    setErrorCode('');
    setResults([]);
    setTotal(0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch(1);
  };

  const columns = [
    {
      title: '文件名', dataIndex: 'fileName', ellipsis: true, width: 200,
      render: (v: string, r: any) => (
        <a onClick={() => router.push(`/traces/${r.traceId}`)}>
          <FileTextOutlined style={{ marginRight: 4 }} />{v}
        </a>
      ),
    },
    {
      title: '任务ID', dataIndex: 'taskId', width: 150, ellipsis: true,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v.slice(0, 18)}...</Text>,
    },
    {
      title: 'Trace ID', dataIndex: 'traceId', width: 160, ellipsis: true,
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v.slice(0, 18)}...</Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          PENDING: { color: 'default', text: '等待' },
          PROCESSING: { color: 'processing', text: '处理中' },
          COMPLETED: { color: 'success', text: '完成' },
          PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
          FAILED: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '总行', dataIndex: 'totalRows', width: 60 },
    {
      title: '成功/失败', width: 100,
      render: (_: any, r: any) => (
        <span>
          <Text style={{ color: '#52c41a' }}>{r.successRows}</Text>
          {' / '}
          <Text style={{ color: r.failedRows > 0 ? '#ff4d4f' : '#999' }}>{r.failedRows}</Text>
        </span>
      ),
    },
    {
      title: '错误', dataIndex: 'errorCount', width: 60,
      render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <Text type="secondary">0</Text>,
    },
    {
      title: '批次', dataIndex: 'totalBatches', width: 60,
    },
    {
      title: '时间', dataIndex: 'createdAt', width: 130,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: '操作', width: 80,
      render: (_: any, r: any) => (
        <Button type="link" size="small" onClick={() => router.push(`/traces/${r.traceId}`)}>
          查看链路
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      {/* 导航 */}
      <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/monitor')}>返回监控</Button>
        </Col>
        <Col>
          <DashboardOutlined style={{ color: '#1677ff' }} />
          <Text strong style={{ fontSize: 18, marginLeft: 8 }}>全链路 Trace 检索</Text>
        </Col>
      </Row>

      {/* 搜索条件 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          <Col span={6}>
            <Input
              placeholder="Task ID"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              onKeyDown={handleKeyDown}
              allowClear
              prefix={<FileTextOutlined />}
            />
          </Col>
          <Col span={6}>
            <Input
              placeholder="文件名（模糊搜索）"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={handleKeyDown}
              allowClear
            />
          </Col>
          <Col span={4}>
            <Input
              placeholder="批次号"
              value={batchIndex}
              onChange={(e) => setBatchIndex(e.target.value)}
              onKeyDown={handleKeyDown}
              allowClear
              type="number"
            />
          </Col>
          <Col span={4}>
            <Space>
              <Input
                placeholder="行号起"
                value={rowFrom}
                onChange={(e) => setRowFrom(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ width: 80 }}
                type="number"
              />
              <Text type="secondary">~</Text>
              <Input
                placeholder="行号止"
                value={rowTo}
                onChange={(e) => setRowTo(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{ width: 80 }}
                type="number"
              />
            </Space>
          </Col>
          <Col span={4}>
            <Select
              placeholder="错误码"
              value={errorCode || undefined}
              onChange={(v) => setErrorCode(v || '')}
              allowClear
              style={{ width: '100%' }}
              options={Object.entries(ERROR_CODES).map(([k, v]) => ({ label: `${k} ${v}`, value: k }))}
            />
          </Col>
        </Row>
        <Divider style={{ margin: '12px 0' }} />
        <Row justify="end">
          <Space>
            <Button onClick={handleReset} icon={<ReloadOutlined />}>重置</Button>
            <Button type="primary" onClick={() => handleSearch(1)} icon={<SearchOutlined />} loading={loading}>
              搜索
            </Button>
          </Space>
        </Row>
      </Card>

      {/* 搜索结果 */}
      <Card
        size="small"
        title={
          <Space>
            <BugOutlined />
            <span>搜索结果 {total > 0 ? <Text type="secondary">（共 {total} 条）</Text> : ''}</span>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={results}
          rowKey="traceId"
          loading={loading}
          size="small"
          pagination={{
            current: page,
            pageSize,
            total,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => handleSearch(p),
            showSizeChanger: false,
          }}
          locale={{ emptyText: '请在上方输入条件后点击搜索' }}
          scroll={{ x: 1100 }}
        />
      </Card>
    </div>
  );
}

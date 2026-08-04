'use client';

/**
 * 导入任务详情与进度页
 * 显示任务状态、进度、错误明细、批次性能
 *
 * 模块六：精细化错误记录
 * - 按批次筛选错误
 * - 按错误类型筛选
 * - 分页加载
 * - 点击行查看原始值、错误原因、修复建议
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Progress, Table, Tag, Button, Card, Space, Statistic, Row, Col, Select, message, Descriptions, Modal, Typography, Spin, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, ReloadOutlined, ExportOutlined,
  BugOutlined, InfoCircleOutlined, BulbOutlined, EyeOutlined,
  ClockCircleOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import type { TaskProgressResponse } from '@/lib/types';
import { ERROR_CODES, SUGGESTED_FIXES } from '@/lib/types';

const { Text, Paragraph } = Typography;

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'default', text: '等待中' },
  PROCESSING: { color: 'processing', text: '处理中' },
  COMPLETED: { color: 'success', text: '已完成' },
  PARTIAL_SUCCESS: { color: 'warning', text: '部分成功' },
  FAILED: { color: 'error', text: '失败' },
};

/** 格式化秒数为可读时间 */
function formatDuration(totalSec: number): string {
  if (totalSec <= 0) return '< 1 秒';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} 小时`);
  if (m > 0) parts.push(`${m} 分`);
  if (s > 0 || parts.length === 0) parts.push(`${s} 秒`);
  return parts.join(' ');
}

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
  const [errorBatchFilter, setErrorBatchFilter] = useState<number | ''>('');
  const [errorPage, setErrorPage] = useState(1);
  const [detailModal, setDetailModal] = useState<{ open: boolean; error: any | null }>({ open: false, error: null });

  const fetchData = useCallback(async () => {
    if (!taskId) return;
    try {
      const [taskRes, errorRes, batchRes] = await Promise.all([
        fetch(`/api/import-tasks/${taskId}`),
        fetch(`/api/import-tasks/${taskId}/errors?errorCode=${errorFilter}&page=${errorPage}&pageSize=20${errorBatchFilter ? `&batch=${errorBatchFilter}` : ''}`),
        fetch(`/api/import-tasks/${taskId}/batches`),
      ]);

      const taskData = await taskRes.json();
      const errorData = await errorRes.json();
      const batchData = await batchRes.json();

      // task detail API 直接返回 TaskProgressResponse 对象
      if (taskData.taskId) {
        setTask(taskData);
      } else if (taskData.error) {
        message.error(taskData.error);
      }

      // error API 返回 { code: 0, data: { list, errorStats, total, ... } }
      if (errorData.code === 0 && errorData.data) {
        setErrors(errorData.data.list || []);
        setErrorStats(errorData.data.errorStats || []);
      }

      // batch API 直接返回 BatchItem[]
      if (Array.isArray(batchData)) {
        setBatches(batchData);
      } else if (batchData.error) {
        // 忽略单次查询错误
      }
    } catch {
      message.error('获取任务信息失败');
    } finally {
      setLoading(false);
    }
  }, [taskId, errorFilter, errorBatchFilter, batchFilter, errorPage]);

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
    { title: '字段', dataIndex: 'fieldName', width: 110 },
    {
      title: '错误码', dataIndex: 'errorCode', width: 75,
      render: (v: string) => <Tag color="red">{v}</Tag>,
    },
    { title: '错误类型', dataIndex: 'errorName', width: 110 },
    {
      title: '错误原因', dataIndex: 'errorReason', ellipsis: true,
    },
    {
      title: '修复建议', dataIndex: 'suggestedFix', width: 180, ellipsis: true,
      render: (v: string) => v ? (
        <Text type="secondary" style={{ fontSize: 12 }}><BulbOutlined style={{ marginRight: 4 }} />{v}</Text>
      ) : '-',
    },
    {
      title: '操作', width: 60, align: 'center' as const,
      render: (_: any, record: any) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setDetailModal({ open: true, error: record });
          }}
        />
      ),
    },
  ];

  const batchColumns = [
    { title: '批次', dataIndex: 'batchIndex', width: 60 },
    { title: '行范围', render: (_: any, r: any) => `${r.startRow} - ${r.endRow}`, width: 120 },
    {
      title: '错误数', dataIndex: 'errorCount', width: 70,
      render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <Text type="secondary">0</Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          PENDING: { color: 'default', text: '等待' },
          QUEUED: { color: 'processing', text: '已入队' },
          PROCESSING: { color: 'processing', text: '处理中' },
          SUCCEEDED: { color: 'success', text: '成功' },
          FAILED: { color: 'error', text: '失败' },
          PARTIAL: { color: 'warning', text: '部分成功' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '重试', dataIndex: 'retryCount', width: 60 },
    {
      title: '耗时', width: 100,
      render: (_: any, r: any) => r.performance ? `${r.performance.totalMs}ms` : '-',
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
            marginTop: 12, padding: '12px 16px',
            background: '#fffbe6', border: '1px solid #ffe58f',
            borderRadius: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div style={{ flex: 1 }}>
                <Text strong style={{ color: '#d48806', fontSize: 14 }}>
                  SKU 校验已降级
                </Text>
                <div style={{ color: '#d48806', fontSize: 13, marginTop: 4 }}>
                  本次导入未经过商品主数据完整校验。
                </div>
                <div style={{ marginTop: 8 }}>
                  <Tag color="orange">降级原因: {task.degradedReason || 'SKU 主数据服务异常'}</Tag>
                  {task.degradedSkuRows > 0 && (
                    <Tag color="volcano">
                      未校验行数: {task.degradedSkuRows}
                    </Tag>
                  )}
                </div>
                <div style={{ color: '#ad6800', fontSize: 12, marginTop: 6 }}>
                  数据可能需要在服务恢复后进行 SKU 补校验。可在错误明细中筛选 E009 错误码查看所有未校验行。
                </div>
              </div>
            </div>
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
            <Progress
              percent={progress}
              status={task.status === 'FAILED' ? 'exception' : 'active'}
              format={() => `${progress}%`}
            />
            <Row gutter={8} style={{ marginTop: 12 }}>
              <Col span={8}>
                <Tooltip title="最近 3 分钟平均吞吐量">
                  <div style={{ color: '#888', fontSize: 12 }}>
                    <ThunderboltOutlined style={{ marginRight: 4 }} />
                    吞吐量: <Text strong>{task.throughput > 0 ? `${task.throughput} 行/秒` : '计算中...'}</Text>
                  </div>
                </Tooltip>
              </Col>
              <Col span={8}>
                <Tooltip title="预计剩余时间">
                  <div style={{ color: '#888', fontSize: 12 }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />
                    预计剩余: <Text strong>{
                      task.estimatedRemainingSec > 0
                        ? formatDuration(task.estimatedRemainingSec)
                        : task.throughput > 0 ? '< 1 秒' : '计算中...'
                    }</Text>
                  </div>
                </Tooltip>
              </Col>
              <Col span={8}>
                <div style={{ color: '#888', fontSize: 12 }}>
                  批次: <Text strong>{task.completedBatches}/{task.totalBatches}</Text>
                </div>
              </Col>
            </Row>
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
        title={
          <Space>
            <BugOutlined style={{ color: '#cf1322' }} />
            错误明细
            {errors.length > 0 && (
              <Tag color="red" style={{ marginLeft: 4 }}>
                {errorPage > 1 ? '第' + errorPage + '页' : ''}
              </Tag>
            )}
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Select
              placeholder="按批次筛选"
              allowClear
              style={{ width: 120 }}
              value={errorBatchFilter || undefined}
              onChange={(v) => { setErrorBatchFilter(v || ''); setErrorPage(1); }}
              options={batches.map((b: any) => ({ label: `第 ${b.batchIndex} 批`, value: b.batchIndex }))}
            />
            <Select
              placeholder="错误类型"
              allowClear
              style={{ width: 140 }}
              value={errorFilter || undefined}
              onChange={(v) => { setErrorFilter(v || ''); setErrorPage(1); }}
              options={Object.entries(ERROR_CODES).map(([k, v]) => ({ label: `${k} ${v}`, value: k }))}
            />
            <Button icon={<ExportOutlined />} size="small" onClick={() => {
              const csv = [
                '批次,行号,字段,错误码,错误类型,错误原因,修复建议,原始值',
                ...errors.map((e: any) =>
                  `${e.batchIndex},${e.rowNumber},${e.fieldName},${e.errorCode},${e.errorName},"${e.errorReason}","${e.suggestedFix || ''}","${e.rawValue || ''}"`
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
          onRow={(record) => ({
            onClick: () => setDetailModal({ open: true, error: record }),
            style: { cursor: 'pointer' },
          })}
          pagination={{
            current: errorPage,
            pageSize: 20,
            onChange: setErrorPage,
            showTotal: (total) => `共 ${total} 条`,
          }}
          locale={{
            emptyText: (task.failedRows > 0 && task.successRows > 0)
              ? '当前筛选条件下没有错误记录'
              : '暂无错误记录',
          }}
        />
      </Card>

      {/* 错误详情弹窗 */}
      <Modal
        title={
          <Space>
            <BugOutlined style={{ color: '#cf1322' }} />
            错误详情
          </Space>
        }
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, error: null })}
        footer={
          <Button onClick={() => setDetailModal({ open: false, error: null })}>
            关闭
          </Button>
        }
        width={600}
      >
        {detailModal.error && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="批次">
              <Tag>{detailModal.error.batchIndex}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="行号">{detailModal.error.rowNumber}</Descriptions.Item>
            <Descriptions.Item label="出错字段">
              <Text code>{detailModal.error.fieldName}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="错误码">
              <Tag color="red">{detailModal.error.errorCode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误类型">{detailModal.error.errorName}</Descriptions.Item>
            <Descriptions.Item label="错误原因">
              <Text type="danger">{detailModal.error.errorReason}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="原始值">
              <Paragraph
                code
                copyable
                ellipsis={{ rows: 2, expandable: true }}
                style={{ marginBottom: 0 }}
              >
                {detailModal.error.rawValueMasked || detailModal.error.rawValue || '(空)'}
              </Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label={
              <Space><BulbOutlined style={{ color: '#faad14' }} />修复建议</Space>
            }>
              <Text type="warning" style={{ whiteSpace: 'pre-wrap' }}>
                {detailModal.error.suggestedFix || SUGGESTED_FIXES[detailModal.error.errorCode] || '请联系技术支持'}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="Trace ID">
              <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {detailModal.error.traceId}
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="记录时间">{detailModal.error.createdAt}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

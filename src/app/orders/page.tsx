'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Table, Tag, Button, Space, Typography, Input, Select, Statistic, Row, Col } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, InboxOutlined, ExportOutlined } from '@ant-design/icons';

const { Title } = Typography;

interface OrderRecord {
  id: string;
  externalCode: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  receiverStore: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  status: string;
  batchId: string;
  importTaskId: string;
  createdAt: string;
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [total, setTotal] = useState(0);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize),
      });
      if (statusFilter) params.set('status', statusFilter);
      if (searchText) params.set('search', searchText);

      const res = await fetch(`/api/orders?${params.toString()}`);
      const json = await res.json();
      if (json.code === 0) {
        setOrders(json.data.list || []);
        setTotal(json.data.total || 0);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, [pagination.page, statusFilter]);

  const columns = [
    { title: '#', width: 30, render: (_: any, __: any, i: number) => (pagination.page - 1) * pagination.pageSize + i + 1 },
    { title: '外部编码', dataIndex: 'externalCode', width: 120, ellipsis: true },
    { title: 'SKU编码', dataIndex: 'skuCode', width: 100, ellipsis: true },
    { title: 'SKU名称', dataIndex: 'skuName', width: 150, ellipsis: true },
    { title: '数量', dataIndex: 'skuQuantity', width: 70 },
    { title: '收货门店', dataIndex: 'receiverStore', width: 120, ellipsis: true },
    { title: '收件人', dataIndex: 'receiverName', width: 90, ellipsis: true },
    { title: '电话', dataIndex: 'receiverPhone', width: 120 },
    { title: '地址', dataIndex: 'receiverAddress', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => {
        const m: Record<string, { color: string; text: string }> = {
          pending: { color: 'processing', text: '待处理' },
          confirmed: { color: 'success', text: '已确认' },
          failed: { color: 'error', text: '失败' },
        };
        const info = m[v] || { color: 'default', text: v };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '导入任务', dataIndex: 'importTaskId', width: 130, ellipsis: true,
      render: (v: string) => v ? (
        <a onClick={() => router.push(`/import-tasks/${v}`)}>
          <Tag color="blue" style={{ cursor: 'pointer' }}>{v.slice(0, 12)}...</Tag>
        </a>
      ) : '-',
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
  ];

  const successCount = orders.filter(o => o.status === 'confirmed').length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const failCount = orders.filter(o => o.status === 'failed').length;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>已导入运单</Title>
            <Typography.Text type="secondary">查看通过万能导入系统生成的运单数据</Typography.Text>
          </div>
          <Space>
            <Button icon={<InboxOutlined />} onClick={() => router.push('/')}>返回导入</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchOrders}>刷新</Button>
          </Space>
        </div>

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="总运单" value={total} suffix="条" /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="已确认" value={successCount} suffix="条" valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="待处理" value={pendingCount} suffix="条" valueStyle={{ color: '#1677ff' }} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="失败" value={failCount} suffix="条" valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        </Row>

        <Card>
          <Space style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="搜索外部编码 / SKU / 门店"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onSearch={fetchOrders}
              style={{ width: 300 }}
              enterButton={<SearchOutlined />}
            />
            <Select
              placeholder="状态筛选"
              allowClear
              value={statusFilter || undefined}
              onChange={setStatusFilter}
              style={{ width: 120 }}
              options={[
                { label: '待处理', value: 'pending' },
                { label: '已确认', value: 'confirmed' },
                { label: '失败', value: 'failed' },
              ]}
            />
          </Space>

          <Table
            columns={columns}
            dataSource={orders}
            rowKey="id"
            loading={loading}
            scroll={{ x: 1300 }}
            pagination={{
              current: pagination.page,
              pageSize: pagination.pageSize,
              total,
              showTotal: t => `共 ${t} 条`,
              onChange: (page, pageSize) => setPagination({ page, pageSize }),
            }}
          />
        </Card>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Card, Table, Input, Typography, Tag, Space, Button, Pagination, message, Empty } from 'antd';
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';

const { Title, Text } = Typography;

interface Order {
  id: string;
  externalCode: string;
  receiverStore: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  skuCode: string;
  skuName: string;
  skuQuantity: number;
  skuSpec: string;
  remark: string;
  batchId: string;
  createdAt: string;
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize) });
      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      setOrders(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      message.error('加载运单列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [page, search]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  const columns = [
    {
      title: '外部编码',
      dataIndex: 'external_code',
      key: 'external_code',
      render: (val: string) => val || '-',
    },
    {
      title: '收货门店',
      dataIndex: 'receiver_store',
      key: 'receiver_store',
      render: (val: string) => val || '-',
    },
    {
      title: '收件人',
      dataIndex: 'receiver_name',
      key: 'receiver_name',
      render: (val: string) => val || '-',
    },
    {
      title: '电话',
      dataIndex: 'receiver_phone',
      key: 'receiver_phone',
      render: (val: string) => val || '-',
    },
    {
      title: '地址',
      dataIndex: 'receiver_address',
      key: 'receiver_address',
      ellipsis: true,
      render: (val: string) => val || '-',
    },
    {
      title: 'SKU编码',
      dataIndex: 'sku_code',
      key: 'sku_code',
    },
    {
      title: 'SKU名称',
      dataIndex: 'sku_name',
      key: 'sku_name',
    },
    {
      title: '数量',
      dataIndex: 'sku_quantity',
      key: 'sku_quantity',
    },
    {
      title: '规格',
      dataIndex: 'sku_spec',
      key: 'sku_spec',
      render: (val: string) => val || '-',
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>已导入运单</Title>
          <div style={{ flex: 1 }} />
          <Input.Search
            placeholder="搜索外部编码/收件人"
            onSearch={handleSearch}
            style={{ width: 280 }}
            allowClear
          />
        </div>

        <Card>
          <Table
            dataSource={orders}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{
              current: page,
              total,
              pageSize,
              onChange: setPage,
              showTotal: (total) => `共 ${total} 条`,
            }}
            scroll={{ x: 1400 }}
            size="small"
            locale={{
              emptyText: <Empty description="暂无运单数据" />,
            }}
          />
        </Card>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Table,
  Input,
  Button,
  Typography,
  DatePicker,
  Tag,
  Modal,
  Descriptions,
  message,
} from "antd";
import { SearchOutlined, EyeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

const { Title } = Typography;
const { RangePicker } = DatePicker;

interface Order {
  id: string;
  externalCode: string;
  storeName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  submittedAt: string;
  skuCount: number;
  status: string;
}

interface OrderDetail {
  id: string;
  externalCode: string;
  storeName: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  remark: string;
  submittedAt: string;
  items: Array<{
    skuCode: string;
    skuName: string;
    quantity: number;
    specification: string;
  }>;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
  });

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);

  const fetchOrders = useCallback(
    async (page = pagination.page, pageSize = pagination.pageSize) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (search) params.set("search", search);
        if (dateRange) {
          params.set("startDate", dateRange[0]);
          params.set("endDate", dateRange[1]);
        }

        const res = await fetch(`/api/orders?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
          setOrders(data.data);
          setPagination((prev) => ({
            ...prev,
            page,
            pageSize,
            total: data.pagination.total,
          }));
        }
      } catch {
        message.error("获取运单列表失败");
      } finally {
        setLoading(false);
      }
    },
    [search, dateRange, pagination.page, pagination.pageSize]
  );

  useEffect(() => {
    fetchOrders(1);
  }, [search, dateRange]);

  const handleViewDetail = async (id: string) => {
    setDetailModalOpen(true);
    setDetailLoading(true);
    setOrderDetail(null);
    try {
      const res = await fetch(`/api/orders/${id}`);
      const data = await res.json();
      if (data.success) {
        setOrderDetail(data.data);
      }
    } catch {
      message.error("获取详情失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    {
      title: "外部编码",
      dataIndex: "externalCode",
      key: "externalCode",
      width: 180,
      render: (text: string) => text || "-",
    },
    {
      title: "收货门店",
      dataIndex: "storeName",
      key: "storeName",
      width: 200,
      ellipsis: true,
      render: (text: string) => text || "-",
    },
    {
      title: "收件人",
      dataIndex: "receiverName",
      key: "receiverName",
      width: 120,
      render: (text: string) => text || "-",
    },
    {
      title: "联系电话",
      dataIndex: "receiverPhone",
      key: "receiverPhone",
      width: 130,
      render: (text: string) => text || "-",
    },
    {
      title: "SKU 数",
      dataIndex: "skuCount",
      key: "skuCount",
      width: 80,
      align: "center" as const,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (status: string) => (
        <Tag color={status === "submitted" ? "green" : "default"}>
          {status === "submitted" ? "已提交" : status}
        </Tag>
      ),
    },
    {
      title: "提交时间",
      dataIndex: "submittedAt",
      key: "submittedAt",
      width: 180,
      render: (text: string) =>
        text ? dayjs(text).format("YYYY-MM-DD HH:mm:ss") : "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_: any, record: Order) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetail(record.id)}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        已导入运单列表
      </Title>

      {/* 搜索栏 */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Input
          placeholder="搜索外部编码 / 收件人姓名"
          prefix={<SearchOutlined />}
          style={{ width: 280 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <RangePicker
          placeholder={["提交开始时间", "提交结束时间"]}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([
                dates[0].startOf("day").toISOString(),
                dates[1].endOf("day").toISOString(),
              ]);
            } else {
              setDateRange(null);
            }
          }}
        />
      </div>

      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => fetchOrders(page, pageSize),
        }}
        scroll={{ x: 1100 }}
        locale={{ emptyText: "暂无运单数据" }}
      />

      {/* 详情弹窗 */}
      <Modal
        title="运单详情"
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={700}
        loading={detailLoading}
      >
        {orderDetail && (
          <div>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="外部编码" span={2}>
                {orderDetail.externalCode || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="收货门店" span={2}>
                {orderDetail.storeName || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="收件人姓名">
                {orderDetail.receiverName || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="收件人电话">
                {orderDetail.receiverPhone || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="收件人地址" span={2}>
                {orderDetail.receiverAddress || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>
                {orderDetail.remark || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="提交时间" span={2}>
                {orderDetail.submittedAt
                  ? dayjs(orderDetail.submittedAt).format("YYYY-MM-DD HH:mm:ss")
                  : "-"}
              </Descriptions.Item>
            </Descriptions>

            <Title level={5}>SKU 明细</Title>
            <Table
              size="small"
              dataSource={orderDetail.items.map((item, idx) => ({
                ...item,
                key: idx,
              }))}
              pagination={false}
              columns={[
                { title: "SKU 编码", dataIndex: "skuCode", width: 150 },
                { title: "SKU 名称", dataIndex: "skuName", width: 180 },
                { title: "数量", dataIndex: "quantity", width: 80 },
                { title: "规格", dataIndex: "specification", width: 120, render: (v: string) => v || "-" },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

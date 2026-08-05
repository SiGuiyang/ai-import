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
import { SearchOutlined, EyeOutlined, SendOutlined } from "@ant-design/icons";
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

  // 搜索表单的暂存状态（输入时不立即查询，点击"查询"按钮才生效）
  const [pendingSearch, setPendingSearch] = useState("");
  const [pendingDateRange, setPendingDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);

  const fetchOrders = useCallback(
    async (page = 1, pageSize = pagination.pageSize, searchValue = search, dateRangeValue = dateRange) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (searchValue) params.set("search", searchValue);
        if (dateRangeValue) {
          params.set("startDate", dateRangeValue[0]);
          params.set("endDate", dateRangeValue[1]);
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
    [search, dateRange, pagination.pageSize]
  );

  useEffect(() => {
    fetchOrders(1);
  }, [search, dateRange, fetchOrders]);

  // 点击查询
  const handleSearch = () => {
    let newDateRange: [string, string] | null = null;
    if (pendingDateRange && pendingDateRange[0] && pendingDateRange[1]) {
      newDateRange = [
        pendingDateRange[0].startOf("day").toISOString(),
        pendingDateRange[1].endOf("day").toISOString(),
      ];
    }
    const newSearch = pendingSearch;
    setSearch(newSearch);
    setDateRange(newDateRange);
    fetchOrders(1, pagination.pageSize, newSearch, newDateRange);
  };

  // 点击重置
  const handleReset = () => {
    setPendingSearch("");
    setPendingDateRange(null);
    setSearch("");
    setDateRange(null);
    fetchOrders(1, pagination.pageSize, "", null);
  };

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

  const handleSubmit = (record: Order) => {
    Modal.confirm({
      title: "确认提交",
      content: `确定要提交运单「${record.externalCode || record.id}」吗？提交后状态将变为已提交。`,
      okText: "提交",
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/orders/${record.id}`, {
            method: "PATCH",
          });
          const data = await res.json();
          if (data.success) {
            message.success("提交成功");
            fetchOrders(pagination.page);
          } else {
            message.error(data.error || "提交失败");
          }
        } catch {
          message.error("提交失败，请重试");
        }
      },
    });
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
      width: 160,
      render: (_: any, record: Order) => (
        <>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            详情
          </Button>
          {record.status === "draft" && (
            <Button
              type="link"
              size="small"
              icon={<SendOutlined />}
              onClick={() => handleSubmit(record)}
            >
              提交
            </Button>
          )}
        </>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        已导入运单列表
      </Title>

      {/* 搜索栏 */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          placeholder="搜索外部编码 / 收件人姓名"
          prefix={<SearchOutlined />}
          style={{ width: 280 }}
          value={pendingSearch}
          onChange={(e) => setPendingSearch(e.target.value)}
          allowClear
          onPressEnter={handleSearch}
        />
        <RangePicker
          placeholder={["提交开始时间", "提交结束时间"]}
          value={pendingDateRange as any}
          onChange={(dates) => {
            setPendingDateRange(dates ? [dates[0], dates[1]] : null);
          }}
        />
        <Button type="primary" onClick={handleSearch}>
          查询
        </Button>
        <Button onClick={handleReset}>
          重置
        </Button>
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

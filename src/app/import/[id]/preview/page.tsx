"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Input,
  message,
  Tag,
  Modal,
  Progress,
  Empty,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  PlusOutlined,
  ExportOutlined,
  SendOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface OrderItem {
  skuCode: string;
  skuName: string;
  quantity: number;
  specification?: string;
}

interface Order {
  externalCode?: string;
  storeName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  remark?: string;
  items: OrderItem[];
}

interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

export default function DataPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const importId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [exporting, setExporting] = useState(false);

  // 加载数据
  useEffect(() => {
    fetchData();
  }, [importId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/import/${importId}/data`);
      const data = await res.json();
      if (data.success) {
        setOrders(data.data.orders || []);
        setFileName(data.data.fileName || "");
      }
    } catch {
      message.error("获取数据失败");
    } finally {
      setLoading(false);
    }
  };

  // 执行校验
  const handleValidate = useCallback(async () => {
    try {
      const res = await fetch(`/api/import/${importId}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();
      if (data.success) {
        setErrors(data.data.errors || []);
        if (data.data.errors.length === 0) {
          message.success("校验通过");
        }
      }
    } catch {
      message.error("校验失败");
    }
  }, [orders, importId]);

  useEffect(() => {
    if (orders.length > 0) {
      handleValidate();
    }
  }, [orders, handleValidate]);

  // 更新订单字段
  const updateOrderField = (idx: number, field: keyof Order, value: any) => {
    setOrders((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  // 更新 SKU 字段
  const updateItemField = (
    orderIdx: number,
    itemIdx: number,
    field: keyof OrderItem,
    value: any
  ) => {
    setOrders((prev) => {
      const next = [...prev];
      const items = [...next[orderIdx].items];
      items[itemIdx] = { ...items[itemIdx], [field]: value };
      next[orderIdx] = { ...next[orderIdx], items };
      return next;
    });
  };

  // 删除 SKU
  const deleteItem = (orderIdx: number, itemIdx: number) => {
    setOrders((prev) => {
      const next = [...prev];
      const items = next[orderIdx].items.filter((_, i) => i !== itemIdx);
      next[orderIdx] = { ...next[orderIdx], items };
      return next;
    });
  };

  // 新增 SKU
  const addItem = (orderIdx: number) => {
    setOrders((prev) => {
      const next = [...prev];
      next[orderIdx] = {
        ...next[orderIdx],
        items: [
          ...next[orderIdx].items,
          { skuCode: "", skuName: "", quantity: 1, specification: "" },
        ],
      };
      return next;
    });
  };

  // 新增出库单
  const addOrder = () => {
    setOrders((prev) => [
      ...prev,
      {
        externalCode: "",
        storeName: "",
        receiverName: "",
        receiverPhone: "",
        receiverAddress: "",
        remark: "",
        items: [{ skuCode: "", skuName: "", quantity: 1, specification: "" }],
      },
    ]);
  };

  // 删除出库单
  const deleteOrder = (idx: number) => {
    setOrders((prev) => prev.filter((_, i) => i !== idx));
  };

  // 导出 Excel
  const handleExport = async () => {
    setExporting(true);
    try {
      // 先保存当前编辑后的数据
      await fetch(`/api/import/${importId}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });

      window.open(`/api/import/${importId}/export`, "_blank");
      message.success("导出成功");
    } catch {
      message.error("导出失败");
    } finally {
      setExporting(false);
    }
  };

  // 提交下单
  const handleSubmit = async () => {
    if (errors.length > 0) {
      message.error("存在校验错误，请修正后提交");
      return;
    }

    setSubmitting(true);
    setSubmitProgress(0);
    setSubmitModalOpen(true);

    try {
      // 先保存
      await fetch(`/api/import/${importId}/data`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });

      setSubmitProgress(50);

      const res = await fetch(`/api/import/${importId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      const data = await res.json();
      setSubmitProgress(100);

      if (data.success) {
        setSubmitResult({
          type: "success",
          success: data.data.success,
          failed: data.data.failed,
          errors: data.data.errors || [],
        });
      } else {
        setSubmitResult({
          type: "error",
          message: data.error,
          errors: data.errors || [],
        });
      }
    } catch {
      setSubmitProgress(0);
      setSubmitResult({ type: "error", message: "提交失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const hasGroupError = (idx: number) =>
    errors.some((e) => e.rowIndex === idx && (e.field === "storeName" || e.field === "receiverName"));

  const hasPhoneError = (idx: number) =>
    errors.some((e) => e.rowIndex === idx && e.field === "receiverPhone");

  const hasDuplicateExternalCode = (idx: number) =>
    errors.some((e) => e.rowIndex === idx && e.field === "externalCode");

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>
            数据预览
          </Title>
          <Text type="secondary">{fileName}</Text>
        </div>
        <Space>
          <Button
            icon={<ExportOutlined />}
            onClick={handleExport}
            loading={exporting}
          >
            导出 Excel
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSubmit}
            disabled={errors.length > 0 || submitting}
          >
            提交下单
          </Button>
        </Space>
      </div>

      {/* 校验错误汇总 */}
      {errors.length > 0 && (
        <Card
          size="small"
          style={{
            marginBottom: 16,
            borderRadius: 8,
            background: "#fff2f0",
            border: "1px solid #ffccc7",
          }}
        >
          <Space>
            <WarningOutlined style={{ color: "#ff4d4f", fontSize: 18 }} />
            <Text type="danger" strong>
              发现 {errors.length} 个错误，请修正后提交
            </Text>
          </Space>
          <div style={{ marginTop: 8, maxHeight: 120, overflow: "auto" }}>
            {errors.map((err, i) => (
              <div key={i} style={{ fontSize: 13, color: "#ff4d4f", lineHeight: "22px" }}>
                第 {err.rowIndex + 1} 个出库单 - {err.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {orders.length === 0 && !loading ? (
        <Empty description="暂无解析数据" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {orders.map((order, idx) => (
            <Card
              key={idx}
              size="small"
              title={
                <Space>
                  <Text strong>
                    出库单 #{idx + 1}
                  </Text>
                  {order.externalCode && (
                    <Tag
                      color={
                        hasDuplicateExternalCode(idx) ? "red" : "#0fc6c2"
                      }
                    >
                      {order.externalCode}
                    </Tag>
                  )}
                </Space>
              }
              extra={
                <Button
                  type="link"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() => deleteOrder(idx)}
                >
                  删除
                </Button>
              }
              style={{
                borderRadius: 12,
                borderColor: hasGroupError(idx) ? "#ff4d4f" : "#f0f0f0",
              }}
            >
              {/* 收货信息 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                  padding: 12,
                  background: "#fafafa",
                  borderRadius: 8,
                }}
              >
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    收货门店 (A组)
                  </Text>
                  <Input
                    size="small"
                    value={order.storeName || ""}
                    onChange={(e) => updateOrderField(idx, "storeName", e.target.value)}
                    status={hasGroupError(idx) ? "error" : undefined}
                    placeholder="输入收货门店"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    收件人姓名 (B组)
                  </Text>
                  <Input
                    size="small"
                    value={order.receiverName || ""}
                    onChange={(e) =>
                      updateOrderField(idx, "receiverName", e.target.value)
                    }
                    status={hasGroupError(idx) ? "error" : undefined}
                    placeholder="输入收件人姓名"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    收件人电话
                  </Text>
                  <Input
                    size="small"
                    value={order.receiverPhone || ""}
                    onChange={(e) =>
                      updateOrderField(idx, "receiverPhone", e.target.value)
                    }
                    status={hasPhoneError(idx) ? "error" : undefined}
                    placeholder="输入手机号"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    收件人地址
                  </Text>
                  <Input
                    size="small"
                    value={order.receiverAddress || ""}
                    onChange={(e) =>
                      updateOrderField(idx, "receiverAddress", e.target.value)
                    }
                    placeholder="输入地址"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    外部编码
                  </Text>
                  <Input
                    size="small"
                    value={order.externalCode || ""}
                    onChange={(e) =>
                      updateOrderField(idx, "externalCode", e.target.value)
                    }
                    status={hasDuplicateExternalCode(idx) ? "error" : undefined}
                    placeholder="输入外部编码"
                  />
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    备注
                  </Text>
                  <TextArea
                    size="small"
                    rows={1}
                    value={order.remark || ""}
                    onChange={(e) =>
                      updateOrderField(idx, "remark", e.target.value)
                    }
                    placeholder="备注"
                  />
                </div>
              </div>

              {/* SKU 明细表 */}
              <Table
                size="small"
                dataSource={order.items.map((item, itemIdx) => ({
                  ...item,
                  key: itemIdx,
                  _orderIdx: idx,
                  _itemIdx: itemIdx,
                  _skuCodeError: errors.some(
                    (e) =>
                      e.rowIndex === idx &&
                      e.field === `items[${itemIdx}].skuCode`
                  ),
                  _skuNameError: errors.some(
                    (e) =>
                      e.rowIndex === idx &&
                      e.field === `items[${itemIdx}].skuName`
                  ),
                  _quantityError: errors.some(
                    (e) =>
                      e.rowIndex === idx &&
                      e.field === `items[${itemIdx}].quantity`
                  ),
                }))}
                pagination={false}
                scroll={{ x: 600 }}
                columns={[
                  {
                    title: "SKU 编码",
                    dataIndex: "skuCode",
                    width: 150,
                    render: (val: string, record: any) => (
                      <Input
                        size="small"
                        value={val}
                        status={record._skuCodeError ? "error" : undefined}
                        onChange={(e) =>
                          updateItemField(
                            record._orderIdx,
                            record._itemIdx,
                            "skuCode",
                            e.target.value
                          )
                        }
                      />
                    ),
                  },
                  {
                    title: "SKU 名称",
                    dataIndex: "skuName",
                    width: 180,
                    render: (val: string, record: any) => (
                      <Input
                        size="small"
                        value={val}
                        status={record._skuNameError ? "error" : undefined}
                        onChange={(e) =>
                          updateItemField(
                            record._orderIdx,
                            record._itemIdx,
                            "skuName",
                            e.target.value
                          )
                        }
                      />
                    ),
                  },
                  {
                    title: "数量",
                    dataIndex: "quantity",
                    width: 80,
                    render: (val: number, record: any) => (
                      <Input
                        size="small"
                        type="number"
                        value={val}
                        status={record._quantityError ? "error" : undefined}
                        onChange={(e) =>
                          updateItemField(
                            record._orderIdx,
                            record._itemIdx,
                            "quantity",
                            Number(e.target.value)
                          )
                        }
                      />
                    ),
                  },
                  {
                    title: "规格",
                    dataIndex: "specification",
                    width: 120,
                    render: (val: string, record: any) => (
                      <Input
                        size="small"
                        value={val || ""}
                        onChange={(e) =>
                          updateItemField(
                            record._orderIdx,
                            record._itemIdx,
                            "specification",
                            e.target.value
                          )
                        }
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 60,
                    align: "center" as const,
                    render: (_: any, record: any) => (
                      <Button
                        type="link"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          deleteItem(record._orderIdx, record._itemIdx)
                        }
                      />
                    ),
                  },
                ]}
                footer={() => (
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => addItem(idx)}
                    block
                  >
                    添加 SKU
                  </Button>
                )}
              />
            </Card>
          ))}

          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addOrder}
            block
            style={{ height: 48 }}
          >
            添加出库单
          </Button>
        </div>
      )}

      {/* 提交确认弹窗 */}
      <Modal
        title="提交下单"
        open={submitModalOpen}
        onCancel={() => {
          if (!submitting) {
            setSubmitModalOpen(false);
            setSubmitResult(null);
          }
        }}
        footer={
          submitResult
            ? [
                <Button
                  key="close"
                  onClick={() => {
                    setSubmitModalOpen(false);
                    setSubmitResult(null);
                    if (submitResult.type === "success") {
                      router.push("/orders");
                    }
                  }}
                >
                  {submitResult.type === "success" ? "查看运单列表" : "关闭"}
                </Button>,
              ]
            : null
        }
      >
        {submitResult ? (
          submitResult.type === "success" ? (
            <div style={{ textAlign: "center", padding: 16 }}>
              <CheckCircleOutlined
                style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }}
              />
              <Title level={4}>提交完成</Title>
              <p>
                成功: <Text type="success" strong>{submitResult.success}</Text> 条
                {submitResult.failed > 0 && (
                  <>
                    ，失败: <Text type="danger" strong>{submitResult.failed}</Text> 条
                  </>
                )}
              </p>
              {submitResult.errors?.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    background: "#fff2f0",
                    borderRadius: 8,
                    maxHeight: 150,
                    overflow: "auto",
                    textAlign: "left",
                  }}
                >
                  {submitResult.errors.map((e: string, i: number) => (
                    <div key={i} style={{ fontSize: 12, color: "#ff4d4f" }}>
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 16 }}>
              <CloseCircleOutlined
                style={{ fontSize: 48, color: "#ff4d4f", marginBottom: 16 }}
              />
              <Text type="danger">{submitResult.message}</Text>
            </div>
          )
        ) : (
          <div style={{ textAlign: "center", padding: 24 }}>
            <Text>
              确认提交 {orders.length} 条出库单？
            </Text>
            <div style={{ marginTop: 16 }}>
              <Progress percent={submitProgress} />
              <Text type="secondary">正在保存数据...</Text>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

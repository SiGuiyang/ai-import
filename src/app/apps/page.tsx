"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Input,
  Space,
  Typography,
  message,
  Tag,
  Modal,
  Form,
  Descriptions,
  Popconfirm,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  KeyOutlined,
  CopyOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  DeleteOutlined,
  ApiOutlined,
} from "@ant-design/icons";

const { Title } = Typography;

interface OpenApp {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  description: string;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export default function AppsPage() {
  const [apps, setApps] = useState<OpenApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [currentApp, setCurrentApp] = useState<OpenApp | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [form] = Form.useForm();

  const fetchApps = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set("keyword", keyword);
      const res = await fetch(`/api/apps?${params}`);
      const data = await res.json();
      if (data.success) {
        setApps(data.data);
      }
    } catch {
      message.error("获取应用列表失败");
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const res = await fetch("/api/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.success) {
        message.success("应用创建成功！请妥善保管 AppSecret");
        setCreateModalOpen(false);
        form.resetFields();
        // 打开详情页展示密钥
        setCurrentApp(data.data);
        setShowSecret(true);
        setDetailModalOpen(true);
        fetchApps();
      } else {
        message.error(data.message || "创建失败");
      }
    } catch {
      // form validation error
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/apps/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        message.success("应用已删除");
        fetchApps();
      } else {
        message.error(data.message || "删除失败");
      }
    } catch {
      message.error("删除失败");
    }
  };

  const handleToggleStatus = async (app: OpenApp) => {
    const newStatus = app.status === "active" ? "disabled" : "active";
    try {
      const res = await fetch(`/api/apps/${app.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(`应用已${newStatus === "active" ? "启用" : "停用"}`);
        fetchApps();
      } else {
        message.error(data.message || "操作失败");
      }
    } catch {
      message.error("操作失败");
    }
  };

  const handleRotateSecret = async (id: string) => {
    try {
      const res = await fetch(`/api/apps/${id}/rotate-secret`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        message.success("AppSecret 已重置");
        setCurrentApp(data.data);
        setShowSecret(true);
      } else {
        message.error(data.message || "重置失败");
      }
    } catch {
      message.error("重置失败");
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(`${label} 已复制到剪贴板`);
    });
  };

  const columns = [
    {
      title: "应用名称",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: OpenApp) => (
        <a onClick={() => {
          setCurrentApp(record);
          setShowSecret(false);
          setDetailModalOpen(true);
        }}>
          <Space>
            <ApiOutlined style={{ color: "#0fc6c2" }} />
            {text}
          </Space>
        </a>
      ),
    },
    {
      title: "App ID",
      dataIndex: "appId",
      key: "appId",
      render: (text: string) => (
        <Tooltip title="点击复制">
          <code
            style={{ cursor: "pointer", fontSize: 12 }}
            onClick={() => copyToClipboard(text, "AppId")}
          >
            {text}
          </code>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) =>
        status === "active" ? (
          <Tag color="#0fc6c2">启用</Tag>
        ) : (
          <Tag color="#ccc">停用</Tag>
        ),
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (text: string) => new Date(text).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_: any, record: OpenApp) => (
        <Space size="small">
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setCurrentApp(record);
              setShowSecret(false);
              setDetailModalOpen(true);
            }}
          >
            详情
          </Button>
          <Button
            size="small"
            onClick={() => handleToggleStatus(record)}
          >
            {record.status === "active" ? "停用" : "启用"}
          </Button>
          <Popconfirm
            title="确定删除此应用？"
            description="删除后将无法通过该应用访问开放接口"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <ApiOutlined style={{ color: "#0fc6c2", fontSize: 20 }} />
            <Title level={4} style={{ margin: 0 }}>开放应用管理</Title>
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setCreateModalOpen(true);
            }}
            style={{ background: "#0fc6c2", borderColor: "#0fc6c2" }}
          >
            创建应用
          </Button>
        }
        style={{ borderRadius: 12 }}
      >
        <div style={{ marginBottom: 16 }}>
          <Input
            placeholder="搜索应用名称..."
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={fetchApps}
            style={{ width: 300 }}
            allowClear
          />
        </div>

        <Table
          columns={columns}
          dataSource={apps}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 创建应用弹窗 */}
      <Modal
        title="创建开放应用"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          form.resetFields();
        }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="应用名称"
            rules={[{ required: true, message: "请输入应用名称" }]}
          >
            <Input placeholder="例如：鲸天下单系统" />
          </Form.Item>
          <Form.Item name="description" label="应用描述">
            <Input.TextArea
              rows={3}
              placeholder="描述应用的用途，可选"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 应用详情弹窗 */}
      <Modal
        title={
          <Space>
            <ApiOutlined style={{ color: "#0fc6c2" }} />
            应用详情
          </Space>
        }
        open={detailModalOpen}
        onCancel={() => {
          setDetailModalOpen(false);
          setShowSecret(false);
        }}
        footer={[
          <Button key="close" onClick={() => setDetailModalOpen(false)}>
            关闭
          </Button>,
          currentApp && (
            <Popconfirm
              key="rotate"
              title="确定重置 AppSecret？"
              description="重置后旧密钥将立即失效，使用旧密钥的客户端将无法访问"
              onConfirm={() => handleRotateSecret(currentApp.id)}
              okText="确定重置"
              cancelText="取消"
            >
              <Button icon={<KeyOutlined />}>重置 AppSecret</Button>
            </Popconfirm>
          ),
        ]}
        width={640}
      >
        {currentApp && (
          <Descriptions column={1} bordered style={{ marginTop: 16 }}>
            <Descriptions.Item label="应用名称">
              {currentApp.name}
            </Descriptions.Item>
            <Descriptions.Item label="App ID">
              <Space>
                <code style={{ fontSize: 13 }}>{currentApp.appId}</code>
                <Tooltip title="复制 AppId">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    type="text"
                    onClick={() => copyToClipboard(currentApp.appId, "AppId")}
                  />
                </Tooltip>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="App Secret">
              <Space>
                <code style={{ fontSize: 13 }}>
                  {showSecret
                    ? currentApp.appSecret
                    : "••••••••••••••••••••••••••••••••"}
                </code>
                <Button
                  size="small"
                  icon={showSecret ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  type="text"
                  onClick={() => setShowSecret(!showSecret)}
                />
                <Tooltip title="复制 AppSecret">
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    type="text"
                    onClick={() =>
                      copyToClipboard(currentApp.appSecret, "AppSecret")
                    }
                  />
                </Tooltip>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag
                color={currentApp.status === "active" ? "#0fc6c2" : "#ccc"}
              >
                {currentApp.status === "active" ? "启用" : "停用"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="描述">
              {currentApp.description || "无"}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(currentApp.createdAt).toLocaleString("zh-CN")}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(currentApp.updatedAt).toLocaleString("zh-CN")}
            </Descriptions.Item>
            <Descriptions.Item label="接口地址">
              <code style={{ fontSize: 12 }}>
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/open`
                  : "/api/open"}
              </code>
            </Descriptions.Item>
            <Descriptions.Item label="签名方式">
              <div>
                <div>HMAC-SHA256 签名</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>
                  请求头: X-App-Id, X-Timestamp, X-Nonce, X-Sign
                </div>
                <div style={{ marginTop: 2, fontSize: 12, color: "#999" }}>
                  签名字符串 = AppId + Timestamp + Nonce + Body + AppSecret
                </div>
              </div>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  Card, Table, Button, Modal, Space, Typography, Tag, Input,
  message, Popconfirm, Switch, Tooltip
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, KeyOutlined, ArrowLeftOutlined,
  CopyOutlined, EyeOutlined, EyeInvisibleOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';

const { Title, Text } = Typography;

interface Credential {
  appId: string;
  appSecret: string;
  appName: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function CredentialsPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('create');
  const [editAppId, setEditAppId] = useState('');
  const [formAppId, setFormAppId] = useState('');
  const [formAppSecret, setFormAppSecret] = useState('');
  const [formAppName, setFormAppName] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/open/credentials');
      const json = await res.json();
      if (json.code === 0) {
        setCredentials(json.data);
      }
    } catch {
      message.error('加载凭证列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCredentials();
  }, []);

  const handleCreate = () => {
    setEditMode('create');
    setFormAppId('');
    setFormAppSecret('');
    setFormAppName('');
    setShowModal(true);
  };

  const handleResetSecret = (record: Credential) => {
    setEditMode('edit');
    setEditAppId(record.appId);
    setFormAppId(record.appId);
    setFormAppSecret('');
    setFormAppName(record.appName);
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!formAppId.trim()) {
      message.warning('请输入 App ID');
      return;
    }
    if (editMode === 'create' && (!formAppSecret || formAppSecret.length < 16)) {
      message.warning('App Secret 长度不能少于 16 位');
      return;
    }

    setFormSubmitting(true);
    try {
      const body: any = {
        appId: formAppId.trim(),
        appSecret: formAppSecret || undefined,
        appName: formAppName.trim() || undefined,
      };
      const res = await fetch('/api/open/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success(editMode === 'create' ? '凭证已创建' : '密钥已重置');
        setShowModal(false);
        loadCredentials();
      } else {
        message.error(json.message || '操作失败');
      }
    } catch {
      message.error('请求失败');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleActive = async (appId: string, active: boolean) => {
    try {
      const res = await fetch('/api/open/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, active }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success(active ? '已启用' : '已禁用');
        setCredentials((prev) =>
          prev.map((c) => (c.appId === appId ? { ...c, active } : c))
        );
      } else {
        message.error(json.message || '操作失败');
      }
    } catch {
      message.error('请求失败');
    }
  };

  const handleDelete = async (appId: string) => {
    try {
      const res = await fetch('/api/open/credentials', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success('凭证已删除');
        loadCredentials();
      } else {
        message.error(json.message || '删除失败');
      }
    } catch {
      message.error('请求失败');
    }
  };

  const toggleSecretVisible = (appId: string) => {
    setVisibleSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label} 已复制到剪贴板`);
    } catch {
      message.error('复制失败');
    }
  };

  const columns = [
    {
      title: 'App ID',
      dataIndex: 'appId',
      key: 'appId',
      render: (val: string) => (
        <Space>
          <Text strong copyable style={{ fontFamily: 'monospace' }}>{val}</Text>
        </Space>
      ),
    },
    {
      title: 'App Secret',
      dataIndex: 'appSecret',
      key: 'appSecret',
      width: 260,
      render: (val: string, record: Credential) => {
        const visible = visibleSecrets.has(record.appId);
        return (
          <Space>
            <Text style={{ fontFamily: 'monospace', fontSize: 13 }}>
              {visible ? val : '••••••••••••••••••••••••••'}
            </Text>
            <Tooltip title={visible ? '隐藏' : '显示'}>
              <Button
                type="link"
                size="small"
                icon={visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => toggleSecretVisible(record.appId)}
              />
            </Tooltip>
            <Tooltip title="复制 Secret">
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(val, 'App Secret')}
              />
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '应用名称',
      dataIndex: 'appName',
      key: 'appName',
      render: (val: string) => val || <Text type="secondary">未命名</Text>,
    },
    {
      title: '状态',
      dataIndex: 'active',
      key: 'active',
      width: 80,
      render: (val: boolean, record: Credential) => (
        <Switch
          checked={val}
          size="small"
          onChange={(checked) => handleToggleActive(record.appId, checked)}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: any, record: Credential) => (
        <Space>
          <Button
            size="small"
            icon={<KeyOutlined />}
            onClick={() => handleResetSecret(record)}
          >
            重置密钥
          </Button>
          <Popconfirm
            title="确认删除？"
            description={`删除后将无法使用 ${record.appId} 访问开放接口`}
            onConfirm={() => handleDelete(record.appId)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>开放接口凭证管理</Title>
          <Tag color="blue">API 鉴权</Tag>
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            创建凭证
          </Button>
        </div>

        {/* Info Alert */}
        <Card style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <Tag color="orange" style={{ fontSize: 13, padding: '4px 8px' }}>鉴权说明</Tag>
            <div>
              <Text>
                调用开放接口时，需要在请求头中携带 <Text code>X-App-Id</Text>、
                <Text code>X-Timestamp</Text> 和 <Text code>X-Sign</Text>。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                签名算法：<Text code style={{ fontSize: 12 }}>X-Sign = HMAC-SHA256(timestamp + appId, appSecret)</Text>，
                时间戳偏差容忍 ±5 分钟。
              </Text>
            </div>
          </div>
        </Card>

        {/* Table */}
        <Card>
          <Table
            dataSource={credentials}
            columns={columns}
            rowKey="appId"
            loading={loading}
            pagination={false}
            locale={{ emptyText: '暂无凭证，点击"创建凭证"开始' }}
          />
        </Card>

        {!loading && credentials.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#86909c' }}>
            <p>还没有注册任何开放接口凭证</p>
            <p>创建凭证后，即可通过 App ID 和 App Secret 访问运单查询接口</p>
          </div>
        )}
      </div>

      {/* Create / Reset Secret Modal */}
      <Modal
        title={editMode === 'create' ? '创建凭证' : '重置密钥'}
        open={showModal}
        onCancel={() => setShowModal(false)}
        onOk={handleSubmit}
        confirmLoading={formSubmitting}
        okText={editMode === 'create' ? '创建' : '确认重置'}
        destroyOnHidden
      >
        {editMode === 'edit' && (
          <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fffbe6', borderRadius: 6, border: '1px solid #ffe58f' }}>
            <Text type="warning" style={{ fontSize: 13 }}>
              重置密钥后，原 Secret 将立即失效，使用旧 Secret 的客户端将无法访问。
            </Text>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <Text>App ID {editMode === 'edit' ? '' : <Text type="danger">*</Text>}</Text>
          </div>
          <Input
            placeholder="输入唯一应用标识，如 my-app"
            value={formAppId}
            onChange={(e) => setFormAppId(e.target.value)}
            disabled={editMode === 'edit'}
            maxLength={64}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <Text>App Secret {editMode === 'create' ? <Text type="danger">*</Text> : <Text type="secondary">（留空则不变）</Text>}</Text>
          </div>
          <Input.Password
            placeholder={editMode === 'create' ? '至少 16 位字符' : '输入新密钥（至少 16 位）'}
            value={formAppSecret}
            onChange={(e) => setFormAppSecret(e.target.value)}
            maxLength={128}
          />
          {editMode === 'create' && (
            <Text type="secondary" style={{ fontSize: 12 }}>密钥长度至少 16 位，建议使用随机字符串</Text>
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 6 }}>
            <Text>应用名称 <Text type="secondary">（可选）</Text></Text>
          </div>
          <Input
            placeholder="便于记忆的描述，如：ERP系统、WMS系统"
            value={formAppName}
            onChange={(e) => setFormAppName(e.target.value)}
            maxLength={64}
          />
        </div>
      </Modal>
    </div>
  );
}

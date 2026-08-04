'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Table, Tag, Button, Space, Typography, Modal, Input, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, InboxOutlined, SafetyCertificateOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';

const { Title } = Typography;

interface Credential {
  id: string;
  name: string;
  token: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
}

export default function CredentialsPage() {
  const router = useRouter();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchCredentials = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/credentials');
      const json = await res.json();
      if (json.code === 0) setCredentials(json.data || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchCredentials(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { message.warning('请输入凭证名称'); return; }
    if (!newToken.trim()) { message.warning('请输入Token'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: uuidv4(),
          name: newName.trim(),
          token: newToken.trim(),
          apiKey: newApiKey.trim(),
          enabled: true,
          createdAt: new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success('凭证创建成功');
        setNewName(''); setNewToken(''); setNewApiKey('');
        setShowCreate(false);
        fetchCredentials();
      } else message.error(json.error || '创建失败');
    } catch { message.error('请求失败'); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/credentials/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.code === 0) {
        message.success('已删除');
        fetchCredentials();
      } else message.error(json.error || '删除失败');
    } catch { message.error('请求失败'); }
  };

  const handleToggle = async (record: Credential) => {
    try {
      const res = await fetch(`/api/credentials/${record.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !record.enabled }),
      });
      const json = await res.json();
      if (json.code === 0) {
        message.success(record.enabled ? '已停用' : '已启用');
        fetchCredentials();
      } else message.error(json.error || '操作失败');
    } catch { message.error('请求失败'); }
  };

  const columns = [
    { title: '#', width: 40, render: (_: any, __: any, i: number) => i + 1 },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: 'Token', dataIndex: 'token', width: 160, ellipsis: true,
      render: (v: string) => <Typography.Text code style={{ fontSize: 11 }}>{v.slice(0, 16)}...</Typography.Text>,
    },
    {
      title: 'API Key', dataIndex: 'apiKey', width: 160, ellipsis: true,
      render: (v: string) => v ? <Typography.Text code style={{ fontSize: 11 }}>{v.slice(0, 16)}...</Typography.Text> : '-',
    },
    {
      title: '状态', dataIndex: 'enabled', width: 80,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString() : '-',
    },
    {
      title: '操作', width: 150,
      render: (_: any, r: Credential) => (
        <Space size="small">
          <Button size="small" onClick={() => handleToggle(r)}>
            {r.enabled ? '停用' : '启用'}
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)} okText="确认" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              <SafetyCertificateOutlined style={{ marginRight: 8, color: '#0fc6c2' }} />
              凭证管理
            </Title>
            <Typography.Text type="secondary">管理用于系统间调用的 API 凭证</Typography.Text>
          </div>
          <Space>
            <Button icon={<InboxOutlined />} onClick={() => router.push('/')}>返回导入</Button>
            <Button icon={<PlusOutlined />} type="primary" onClick={() => setShowCreate(true)}>新建凭证</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchCredentials}>刷新</Button>
          </Space>
        </div>

        <Card>
          <Table
            columns={columns}
            dataSource={credentials}
            rowKey="id"
            loading={loading}
            pagination={false}
            locale={{ emptyText: '暂无凭证，点击"新建凭证"创建' }}
          />
        </Card>

        <Modal
          title="新建凭证"
          open={showCreate}
          onCancel={() => setShowCreate(false)}
          onOk={handleCreate}
          confirmLoading={saving}
          okText="创建"
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Typography.Text strong>凭证名称</Typography.Text>
              <Input placeholder="例如: 主系统访问凭证" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div>
              <Typography.Text strong>Token</Typography.Text>
              <Input.Password placeholder="输入Token" value={newToken} onChange={e => setNewToken(e.target.value)} />
            </div>
            <div>
              <Typography.Text strong>API Key（可选）</Typography.Text>
              <Input placeholder="输入API Key" value={newApiKey} onChange={e => setNewApiKey(e.target.value)} />
            </div>
          </Space>
        </Modal>
      </div>
    </div>
  );
}

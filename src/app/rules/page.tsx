'use client';

import { useState, useEffect } from 'react';
import { Card, Table, Button, Modal, Space, Typography, Tag, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined, EyeOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import type { ParseRule } from '@/lib/types';
import { getRules, deleteRule, createRule } from '@/lib/rule-store';
import RuleEditor from '@/components/RuleEditor';

const { Title, Text } = Typography;

export default function RulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<ParseRule | null>(null);

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await getRules();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteRule(id);
    message.success('规则已删除');
    loadRules();
  };

  const handleCopy = async (rule: ParseRule) => {
    const now = new Date().toISOString();
    const copy: ParseRule = {
      ...rule,
      id: uuidv4(),
      name: rule.name + ' (副本)',
      createdAt: now,
      updatedAt: now,
    };
    await createRule(copy);
    message.success('规则已复制');
    loadRules();
  };

  const handleNewRule = () => {
    const now = new Date().toISOString();
    const newRule: ParseRule = {
      id: uuidv4(),
      name: '新规则',
      fileType: 'excel',
      description: '',
      sourceArea: { sheetMode: 'first', headerSkipRows: 0, headerRowIndex: 1, dataStartRow: 2 },
      columnMappings: [],
      tailExtractions: [],
      aiGenerated: false,
      createdAt: now,
      updatedAt: now,
    };
    setEditingRule(newRule);
    setShowEditor(true);
  };

  const handleEdit = (rule: ParseRule) => {
    setEditingRule(rule);
    setShowEditor(true);
  };

  const handleSave = () => {
    setShowEditor(false);
    setEditingRule(null);
    message.success('规则已保存');
    loadRules();
  };

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (val: string, record: ParseRule) => (
        <div>
          <Text strong>{val}</Text>
          {record.aiGenerated && <Tag color="blue" style={{ marginLeft: 8 }}>AI生成</Tag>}
        </div>
      ),
    },
    {
      title: '文件类型',
      dataIndex: 'fileType',
      key: 'fileType',
      render: (val: string) => {
        const colors: Record<string, string> = { excel: 'green', word: 'orange', pdf: 'red' };
        return <Tag color={colors[val] || 'default'}>{val.toUpperCase()}</Tag>;
      },
    },
    {
      title: '字段映射数',
      key: 'mappings',
      render: (_: any, record: ParseRule) => record.columnMappings?.length ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: ParseRule) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => handleCopy(record)}>复制</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', padding: '24px 16px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>解析规则管理</Title>
          <div style={{ flex: 1 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNewRule}>新建规则</Button>
        </div>

        <Card>
          <Table
            dataSource={rules}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={false}
            locale={{ emptyText: '暂无规则，点击"新建规则"创建' }}
          />
        </Card>

        {!loading && rules.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#86909c' }}>
            <p>还没有解析规则</p>
            <p>可以通过导入页的"AI 辅助新建规则"来自动生成</p>
          </div>
        )}
      </div>

      <Modal
        title={editingRule?.aiGenerated ? '编辑 AI 生成规则' : '编辑规则'}
        open={showEditor}
        onCancel={() => { setShowEditor(false); setEditingRule(null); }}
        width={800}
        footer={null}
        destroyOnHidden
      >
        {editingRule && (
          <RuleEditor
            initialRule={editingRule}
            file={null}
            onSave={handleSave}
            onCancel={() => { setShowEditor(false); setEditingRule(null); }}
          />
        )}
      </Modal>
    </div>
  );
}

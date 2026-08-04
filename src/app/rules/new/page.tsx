'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Typography, Space, message } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import RuleEditor from '@/components/RuleEditor';
import { createRule } from '@/lib/rule-store';
import type { ParseRule } from '@/lib/types';

const { Title } = Typography;

function createEmptyRule(): ParseRule {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name: '',
    fileType: 'excel',
    description: '',
    sourceArea: {
      sheetMode: 'first',
      headerSkipRows: 0,
      headerRowIndex: 1,
      dataStartRow: 2,
    },
    columnMappings: [],
    tailExtractions: [],
    aiGenerated: false,
    createdAt: now,
    updatedAt: now,
  };
}

export default function NewRulePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = async (rule: ParseRule) => {
    if (saving) return;
    setSaving(true);
    try {
      await createRule(rule);
      message.success('规则创建成功');
      router.push('/rules');
    } catch {
      message.error('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.push('/rules');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', paddingBottom: 40 }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
        <Space align="center" style={{ marginBottom: 24 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel} type="text" />
          <Title level={4} style={{ margin: 0 }}>手动创建规则</Title>
        </Space>
        <Card>
          <RuleEditor
            initialRule={createEmptyRule()}
            file={null}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </Card>
      </div>
    </div>
  );
}

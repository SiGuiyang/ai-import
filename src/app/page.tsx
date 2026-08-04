'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Button, Card, Typography, Space, message, Spin } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { getRules } from '@/lib/rule-store';
import type { ParseRule } from '@/lib/types';

const { Dragger } = Upload;
const { Title, Text } = Typography;

export default function HomePage() {
  const router = useRouter();
  const fileRef = useRef<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rules, setRules] = useState<ParseRule[]>([]);

  // === 异步上传（走 /api/import-tasks 管道） ===
  const handleAsyncUpload = async () => {
    const file = fileRef.current;
    if (!file) {
      message.warning('请先选择文件');
      return;
    }

    // 取第一个已激活的规则
    const activeRule = rules.find((r) => r.enabled);
    if (!activeRule) {
      message.warning('请先在规则管理中创建并启用一个解析规则');
      return;
    }

    // 防重复点击
    if (uploading) return;
    setUploading(true);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('rule', JSON.stringify(activeRule.rule || activeRule));

      const res = await fetch('/api/import-tasks', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        message.error(data.message || '上传失败');
        return;
      }

      // 去重命中
      if (data.status === 'DUPLICATE') {
        message.info(data.message);
        router.push(`/import-tasks/${data.task_id}`);
        return;
      }

      message.success(`任务已创建，共 ${data.totalRows} 行，${data.totalBatches} 批`);
      router.push(`/import-tasks/${data.task_id}`);
    } catch (err) {
      message.error(`上传请求失败: ${String(err)}`);
    } finally {
      setUploading(false);
    }
  };

  // 加载规则列表
  useEffect(() => {
    getRules().then(setRules).catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 720, margin: '60px auto', padding: '0 16px' }}>
      <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
        AI 智慧导入
      </Title>
      <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 32 }}>
        上传 Excel / Word 文件，即时返回任务 ID，后台异步导入
      </Text>

      <Card>
        <Dragger
          accept=".xlsx,.xls,.docx,.csv"
          maxCount={1}
          multiple={false}
          beforeUpload={(file) => {
            fileRef.current = file;
            return false; // 阻止默认上传
          }}
          onRemove={() => {
            fileRef.current = null;
          }}
          disabled={uploading}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">
            支持 .xlsx .xls .docx .csv，最多 10,000 行
          </p>
        </Dragger>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Button
            type="primary"
            size="large"
            icon={uploading ? <Spin size="small" /> : undefined}
            disabled={uploading || !fileRef.current}
            onClick={handleAsyncUpload}
          >
            {uploading ? '正在创建任务...' : '上传并导入'}
          </Button>
        </div>

        {uploading && (
          <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>
            正在解析文件并创建异步导入任务，请稍候...
          </Text>
        )}
      </Card>

      <Space style={{ marginTop: 32, justifyContent: 'center', width: '100%' }} size="large">
        <Button type="link" onClick={() => router.push('/import-tasks')}>
          导入任务列表
        </Button>
        <Button type="link" onClick={() => router.push('/orders')}>
          已导入运单
        </Button>
        <Button type="link" onClick={() => router.push('/rules')}>
          规则管理
        </Button>
        <Button type="link" onClick={() => router.push('/monitor')}>
          监控看板
        </Button>
      </Space>
    </div>
  );
}

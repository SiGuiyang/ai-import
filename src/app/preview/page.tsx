'use client';

import { useState, useEffect, Suspense } from 'react';
import { Card, Typography, Button, Spin, message, Alert } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import DataTable from '@/components/DataTable';
import { validateRecords } from '@/lib/validators';
import type { ValidationError } from '@/lib/types';

const { Title } = Typography;

function PreviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = searchParams.get('data');
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(raw));
        setData(parsed);
        const { errors, groupDuplicateWarning } = validateRecords(parsed);
        setValidationErrors(errors);
        setDuplicateWarnings(groupDuplicateWarning);
      }
    } catch {
      message.error('数据解析失败');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  const handleDataChange = (newData: Record<string, unknown>[]) => {
    setData(newData);
    const { errors, groupDuplicateWarning } = validateRecords(newData);
    setValidationErrors(errors);
    setDuplicateWarnings(groupDuplicateWarning);
  };

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  return (
    <div>
      {validationErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message={`发现 ${validationErrors.length} 个数据错误`}
          style={{ marginBottom: 16 }}
        />
      )}
      <DataTable
        data={data}
        onChange={handleDataChange}
        validationErrors={validationErrors}
        duplicateWarnings={duplicateWarnings}
      />
    </div>
  );
}

export default function PreviewPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>数据预览与编辑</Title>
        </div>
        <Card>
          <Suspense fallback={<Spin style={{ display: 'block', margin: '80px auto' }} />}>
            <PreviewContent />
          </Suspense>
        </Card>
      </div>
    </div>
  );
}

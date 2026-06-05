'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { Card, Typography, Button, Spin, message, Alert, Table, Tag, Collapse } from 'antd';
import { ArrowLeftOutlined, WarningOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import DataTable from '@/components/DataTable';
import { validateRecords } from '@/lib/validators';
import type { ValidationError } from '@/lib/types';

const { Title, Text } = Typography;

interface ErrorItem {
  key: string;
  row: number;
  field: string;
  message: string;
  type: 'error' | 'warning';
}

function PreviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([]);
  const [dbDuplicates, setDbDuplicates] = useState<Set<string>>(new Set());
  const [errorPanelOpen, setErrorPanelOpen] = useState(true);

  // 加载数据
  useEffect(() => {
    try {
      const raw = searchParams.get('data');
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(raw));
        setData(parsed);
        runValidation(parsed);
      }
    } catch {
      message.error('数据解析失败');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  // 执行校验（含数据库重复检测）
  const runValidation = useCallback(async (records: Record<string, unknown>[]) => {
    // 本地校验
    const { errors, groupDuplicateWarning } = validateRecords(records);
    setValidationErrors(errors);
    setDuplicateWarnings(groupDuplicateWarning);

    // 数据库重复检测
    const codes = [...new Set(
      records
        .map(r => (r.externalCode as string)?.trim())
        .filter(Boolean)
    )];

    if (codes.length > 0) {
      try {
        const res = await fetch('/api/orders/check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes }),
        });
        const result = await res.json();
        if (result.duplicateCodes) {
          setDbDuplicates(new Set(result.duplicateCodes));
        }
      } catch {
        // 忽略数据库检查错误，不影响主流程
      }
    } else {
      setDbDuplicates(new Set());
    }
  }, []);

  // 数据变化时重新校验
  const handleDataChange = useCallback((newData: Record<string, unknown>[]) => {
    setData(newData);
    runValidation(newData);
  }, [runValidation]);

  // 合并所有错误和警告，构建错误面板数据
  const allErrorItems: ErrorItem[] = useMemo(() => {
    const items: ErrorItem[] = [];

    // 本地校验错误
    for (const err of validationErrors) {
      items.push({
        key: `err-${err.row}-${err.field}`,
        row: err.row,
        field: err.field,
        message: err.message,
        type: 'error',
      });
    }

    // 同批次重复警告
    for (const warn of duplicateWarnings) {
      const rowMatch = warn.match(/第(\d+)行/);
      const row = rowMatch ? parseInt(rowMatch[1]) : 0;
      items.push({
        key: `dup-${warn}`,
        row,
        field: 'externalCode',
        message: warn,
        type: 'warning',
      });
    }

    // 数据库重复警告
    for (const code of dbDuplicates) {
      const rows = data
        .map((r, i) => ((r.externalCode as string)?.trim() === code ? i + 1 : -1))
        .filter(r => r > 0);
      for (const row of rows) {
        items.push({
          key: `dbdup-${code}-${row}`,
          row,
          field: 'externalCode',
          message: `第${row}行的外部编码"${code}"在数据库中已存在（重复）`,
          type: 'warning',
        });
      }
    }

    // 按行号排序
    items.sort((a, b) => a.row - b.row || a.field.localeCompare(b.field));
    return items;
  }, [validationErrors, duplicateWarnings, dbDuplicates, data]);

  // 是否有重复行（用于 DataTable 高亮）
  const duplicateRows = useMemo(() => {
    const rows = new Set<number>();
    for (const warn of duplicateWarnings) {
      const m = warn.match(/第(\d+)行/);
      if (m) rows.add(parseInt(m[1]));
    }
    for (const code of dbDuplicates) {
      data.forEach((r, i) => {
        if ((r.externalCode as string)?.trim() === code) rows.add(i + 1);
      });
    }
    return rows;
  }, [duplicateWarnings, dbDuplicates, data]);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  const errorCount = allErrorItems.filter(e => e.type === 'error').length;
  const warningCount = allErrorItems.filter(e => e.type === 'warning').length;

  const errorColumns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (type: string) =>
        type === 'error' ? (
          <Tag color="red"><ExclamationCircleOutlined /> 错误</Tag>
        ) : (
          <Tag color="warning"><WarningOutlined /> 警告</Tag>
        ),
    },
    {
      title: '行号',
      dataIndex: 'row',
      key: 'row',
      width: 80,
      render: (row: number) => <Text strong>{row}</Text>,
    },
    {
      title: '字段',
      dataIndex: 'field',
      key: 'field',
      width: 160,
      render: (field: string) => <Text code>{field}</Text>,
    },
    {
      title: '描述',
      dataIndex: 'message',
      key: 'message',
    },
  ];

  return (
    <div>
      {/* 错误/警告汇总面板 */}
      {(errorCount > 0 || warningCount > 0) && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={
            <span>
              {errorCount > 0 && <Tag color="red">错误 {errorCount}</Tag>}
              {warningCount > 0 && <Tag color="warning">警告 {warningCount}</Tag>}
              <Text type="secondary" style={{ fontSize: 12 }}>点击展开/收起详情</Text>
            </span>
          }
        >
          <Collapse
            activeKey={errorPanelOpen ? ['errors'] : []}
            onChange={(keys) => setErrorPanelOpen(keys.includes('errors'))}
            ghost
            items={[
              {
                key: 'errors',
                label: `共 ${allErrorItems.length} 个问题（${errorCount} 个错误，${warningCount} 个警告）`,
                children: (
                  <Table
                    dataSource={allErrorItems}
                    columns={errorColumns}
                    rowKey="key"
                    size="small"
                    pagination={allErrorItems.length > 20 ? { pageSize: 20, showTotal: (t: number) => `共 ${t} 条` } : false}
                    scroll={{ y: 320 }}
                    style={{ maxHeight: 360, overflow: 'auto' }}
                  />
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* 无错误时的成功提示 */}
      {errorCount === 0 && warningCount === 0 && data.length > 0 && (
        <Alert
          type="success"
          message={`数据校验通过，共 ${data.length} 条记录，可提交`}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <DataTable
        data={data}
        onChange={handleDataChange}
        validationErrors={validationErrors}
        duplicateWarnings={duplicateWarnings}
        duplicateRows={duplicateRows}
        dbDuplicates={dbDuplicates}
      />
    </div>
  );
}

export default function PreviewPage() {
  const router = useRouter();

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
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

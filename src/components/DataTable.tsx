'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Table, Input, Tooltip, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ValidationError } from '@/lib/types';

interface Props {
  data: Record<string, unknown>[];
  onChange: (data: Record<string, unknown>[]) => void;
  validationErrors: ValidationError[];
  duplicateWarnings: string[];
}

export default function DataTable({ data, onChange, validationErrors, duplicateWarnings }: Props) {
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<any>(null);

  const fields = [
    { key: 'rowIndex', title: '#', width: 50, fixed: 'left' as const },
    { key: 'externalCode', title: '外部编码', width: 140 },
    { key: 'receiverStore', title: '收货门店', width: 160 },
    { key: 'receiverName', title: '收件人姓名', width: 120 },
    { key: 'receiverPhone', title: '收件人电话', width: 140 },
    { key: 'receiverAddress', title: '收件人地址', width: 200 },
    { key: 'skuCode', title: 'SKU编码', width: 140 },
    { key: 'skuName', title: 'SKU名称', width: 160 },
    { key: 'skuQuantity', title: '发货数量', width: 100 },
    { key: 'skuSpec', title: '规格型号', width: 120 },
    { key: 'remark', title: '备注', width: 160 },
  ];

  const getErrorFor = (row: number, field: string): ValidationError | undefined => {
    return validationErrors.find(e => e.row === row && e.field === field);
  };

  const isRowDuplicate = (row: number): boolean => {
    return duplicateWarnings.some(w => w.includes(`第${row}行`));
  };

  const handleCellClick = (rowIdx: number, field: string, value: string) => {
    setEditingCell({ row: rowIdx, field });
    setEditValue(value || '');
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    const newData = [...data];
    const record = { ...newData[editingCell.row] };
    record[editingCell.field] = editValue;
    newData[editingCell.row] = record;
    onChange(newData);
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellSave();
    }
    if (e.key === 'Escape') {
      setEditingCell(null);
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      handleCellSave();
    }
  };

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingCell]);

  const handleDelete = (rowIdx: number) => {
    const newData = data.filter((_, i) => i !== rowIdx);
    onChange(newData);
    message.success('已删除第 ' + (rowIdx + 1) + ' 行');
  };

  const handleAdd = () => {
    const newRecord: Record<string, unknown> = {
      externalCode: '', receiverStore: '', receiverName: '',
      receiverPhone: '', receiverAddress: '', skuCode: '',
      skuName: '', skuQuantity: '', skuSpec: '', remark: '',
    };
    onChange([...data, newRecord]);
  };

  const displayData = data.map((rec, idx) => ({
    ...rec,
    rowIndex: idx + 1,
    _rawIdx: idx,
  }));

  const columns: ColumnsType<any> = [
    ...fields.map(f => ({
      key: f.key,
      title: f.title,
      dataIndex: f.key,
      width: f.width,
      fixed: f.fixed,
      onCell: (record: any, rowIdx?: number) => ({
        onClick: () => {
          if (rowIdx !== undefined && f.key !== 'rowIndex') {
            handleCellClick(record._rawIdx, f.key as string, String(record[f.key] || ''));
          }
        },
      }),
      render: (val: any, record: any) => {
        const rowNum = record._rawIdx + 1;
        const err = getErrorFor(rowNum, f.key);
        const isEditing = editingCell?.row === record._rawIdx && editingCell?.field === f.key;

        if (f.key === 'rowIndex') {
          const isDup = isRowDuplicate(rowNum);
          return (
            <div>
              <Tag color={isDup ? 'warning' : 'default'}>{val}</Tag>
            </div>
          );
        }

        if (isEditing) {
          return (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={handleCellSave}
              onKeyDown={handleKeyDown}
              size="small"
              status={err ? 'error' : undefined}
              style={{ width: '100%' }}
            />
          );
        }

        const isRequired = ['skuCode', 'skuName', 'skuQuantity'].includes(f.key);
        const isEmpty = !val && val !== 0;

        return (
          <Tooltip title={err?.message || '点击编辑'}>
            <div
              style={{
                minHeight: 24, cursor: 'text', padding: '2px 4px',
                background: err ? '#fff2f0' : isEmpty && isRequired ? '#fffbe6' : 'transparent',
                border: err ? '1px solid #ff4d4f' : '1px solid transparent',
                borderRadius: 2,
              }}
            >
              {err && <Tag color="red" style={{ fontSize: 10, marginRight: 4 }}>错误</Tag>}
              {val || (isRequired ? <span style={{ color: '#d9d9d9' }}>必填</span> : '-')}
            </div>
          </Tooltip>
        );
      },
    })),
    {
      key: '_actions',
      title: '操作',
      width: 100,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <a onClick={() => handleDelete(record._rawIdx)} style={{ color: '#ff4d4f' }}>删除</a>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <a onClick={handleAdd} style={{ color: '#0fc6c2' }}>+ 新增空行</a>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e5e6eb', borderRadius: 8 }}>
        <Table
          columns={columns}
          dataSource={displayData}
          rowKey="_rawIdx"
          pagination={false}
          scroll={{ x: 1600, y: 480 }}
          size="small"
          bordered
          virtual={displayData.length > 100}
        />
      </div>
    </div>
  );
}

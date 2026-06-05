'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Table, Input, Tooltip, Tag, message, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ValidationError } from '@/lib/types';
import * as XLSX from 'xlsx';

interface Props {
  data: Record<string, unknown>[];
  onChange: (data: Record<string, unknown>[]) => void;
  validationErrors: ValidationError[];
  duplicateWarnings: string[];
  duplicateRows?: Set<number>;   // 重复行号集合（1-based）
  dbDuplicates?: Set<string>;    // 数据库重复的外部编码
}

// 温层合法值
const VALID_TEMP_LAYERS = new Set(['常温', '冷链', '冷冻', '恒温', 'normal', 'cold_chain', 'frozen', 'constant_temp', '冷藏']);

export default function DataTable({
  data, onChange, validationErrors, duplicateWarnings, duplicateRows, dbDuplicates,
}: Props) {
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const inputRef = useRef<any>(null);

  const fields = useMemo(() => [
    { key: 'rowIndex', title: '#', width: 50, fixed: 'left' as const, editable: false },
    { key: 'externalCode', title: '外部编码', width: 140, editable: true },
    { key: 'receiverStore', title: '收货门店', width: 160, editable: true },
    { key: 'receiverName', title: '收件人姓名', width: 120, editable: true },
    { key: 'receiverPhone', title: '收件人电话', width: 140, editable: true },
    { key: 'receiverAddress', title: '收件人地址', width: 200, editable: true },
    { key: 'skuCode', title: 'SKU编码', width: 140, editable: true },
    { key: 'skuName', title: 'SKU名称', width: 160, editable: true },
    { key: 'skuQuantity', title: '发货数量', width: 100, editable: true },
    { key: 'skuSpec', title: '规格型号', width: 120, editable: true },
    { key: 'temperatureLayer', title: '温层', width: 100, editable: true },
    { key: 'weight', title: '重量', width: 90, editable: true },
    { key: 'pieces', title: '件数', width: 90, editable: true },
    { key: 'remark', title: '备注', width: 160, editable: true },
  ], []);

  const editableFields = useMemo(() => fields.filter(f => f.editable), [fields]);

  // 构建行号→错误列表的索引
  const errorsByRow = useMemo(() => {
    const map = new Map<number, ValidationError[]>();
    for (const err of validationErrors) {
      if (!map.has(err.row)) map.set(err.row, []);
      map.get(err.row)!.push(err);
    }
    return map;
  }, [validationErrors]);

  const isRowDuplicate = useCallback((row: number): boolean => {
    if (!duplicateRows) return false;
    return duplicateRows.has(row);
  }, [duplicateRows]);

  const isCellDbDuplicate = useCallback((row: number, field: string): boolean => {
    if (field !== 'externalCode' || !dbDuplicates) return false;
    const code = (data[row - 1]?.externalCode as string)?.trim();
    return !!code && dbDuplicates.has(code);
  }, [data, dbDuplicates]);

  // 获取单元格错误
  const getErrorFor = useCallback((row: number, field: string): ValidationError | undefined => {
    const errs = errorsByRow.get(row);
    return errs?.find(e => e.field === field);
  }, [errorsByRow]);

  // 温层值是否非法
  const isInvalidTempLayer = useCallback((val: unknown): boolean => {
    if (val === undefined || val === null || val === '') return false;
    return !VALID_TEMP_LAYERS.has(String(val).trim());
  }, []);

  // ---- 编辑逻辑 ----
  const handleCellClick = useCallback((rowIdx: number, field: string, value: string) => {
    const fld = editableFields.find(f => f.key === field);
    if (!fld) return;
    setEditingCell({ row: rowIdx, field });
    setEditValue(value || '');
    const colIdx = editableFields.findIndex(f => f.key === field);
    setActiveCell({ row: rowIdx, col: colIdx });
  }, [editableFields]);

  const handleCellSave = useCallback(() => {
    if (!editingCell) return;
    const newData = [...data];
    const record = { ...newData[editingCell.row] };
    record[editingCell.field] = editValue;
    newData[editingCell.row] = record;
    onChange(newData);
    setEditingCell(null);
  }, [editingCell, editValue, data, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editingCell) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      handleCellSave();
      // 移动到下一行同列
      if (editingCell.row < data.length - 1) {
        const nextRow = editingCell.row + 1;
        const val = String(data[nextRow]?.[editingCell.field] || '');
        setEditingCell({ row: nextRow, field: editingCell.field });
        setEditValue(val);
        setActiveCell({ row: nextRow, col: activeCell?.col ?? 0 });
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingCell(null);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      handleCellSave();
      // 移动到右侧单元格
      const currentCol = activeCell?.col ?? 0;
      const nextCol = e.shiftKey
        ? Math.max(0, currentCol - 1)
        : Math.min(editableFields.length - 1, currentCol + 1);
      if (nextCol !== currentCol || !e.shiftKey) {
        const field = editableFields[nextCol]?.key;
        if (field) {
          const val = String(data[editingCell.row]?.[field] || '');
          setEditingCell({ row: editingCell.row, field });
          setEditValue(val);
          setActiveCell({ row: editingCell.row, col: nextCol });
        }
      }
      return;
    }
    // 方向键：移动选中格（不编辑时由全局监听处理）
  }, [editingCell, editValue, data, onChange, handleCellSave, activeCell, editableFields]);

  // 自动聚焦输入框
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      // 全选文本
      inputRef.current.select?.();
    }
  }, [editingCell]);

  // ---- 行操作 ----
  const handleDelete = useCallback((rowIdx: number) => {
    const newData = data.filter((_, i) => i !== rowIdx);
    onChange(newData);
    message.success(`已删除第 ${rowIdx + 1} 行`);
  }, [data, onChange]);

  const handleAdd = useCallback(() => {
    const newRecord: Record<string, unknown> = {};
    for (const f of editableFields) {
      newRecord[f.key] = '';
    }
    newRecord.externalCode = '';
    newRecord.receiverStore = '';
    newRecord.receiverName = '';
    newRecord.receiverPhone = '';
    newRecord.receiverAddress = '';
    newRecord.skuCode = '';
    newRecord.skuName = '';
    newRecord.skuQuantity = '';
    newRecord.skuSpec = '';
    newRecord.remark = '';
    onChange([...data, newRecord]);
    message.success('已新增空行');
  }, [data, onChange, editableFields]);

  // ---- 导出 Excel ----
  const handleExport = useCallback(() => {
    try {
      const exportData = data.map((rec, idx) => {
        const row: Record<string, unknown> = { 行号: idx + 1 };
        for (const f of fields) {
          if (f.key !== 'rowIndex') {
            row[f.title] = rec[f.key] ?? '';
          }
        }
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(exportData);

      // 设置列宽
      ws['!cols'] = fields.filter(f => f.key !== 'rowIndex').map(f => ({ wch: Math.max(f.width / 7, 12) }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '预览数据');
      XLSX.writeFile(wb, `预览数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
      message.success('导出成功');
    } catch (e: any) {
      message.error('导出失败：' + String(e));
    }
  }, [data, fields]);

  // ---- 构建表格数据 ----
  const displayData = useMemo(() =>
    data.map((rec, idx) => ({
      ...rec,
      rowIndex: idx + 1,
      _rawIdx: idx,
    }))
  , [data]);

  // ---- 行样式：重复行高亮 ----
  const rowClassName = useCallback((record: any) => {
    const rowNum = record._rawIdx + 1;
    if (isRowDuplicate(rowNum)) return 'row-duplicate';
    if (errorsByRow.has(rowNum)) return 'row-has-error';
    return '';
  }, [isRowDuplicate, errorsByRow]);

  // ---- 列定义 ----
  const columns: ColumnsType<any> = useMemo(() =>
    fields.map(f => ({
      key: f.key,
      title: f.title,
      dataIndex: f.key,
      width: f.width,
      fixed: f.fixed,
      onCell: (record: any, rowIdx?: number) => ({
        onClick: () => {
          if (rowIdx !== undefined && f.key !== 'rowIndex' && f.editable) {
            handleCellClick(record._rawIdx, f.key, String(record[f.key] || ''));
          }
        },
        style: { cursor: f.editable ? 'text' : 'default' },
      }),
      render: (val: any, record: any) => {
        const rowNum = record._rawIdx + 1;
        const isDup = isRowDuplicate(rowNum);
        const isDbDup = isCellDbDuplicate(rowNum, f.key);
        const err = getErrorFor(rowNum, f.key);
        const isEditing = editingCell?.row === record._rawIdx && editingCell?.field === f.key;
        const isTempInvalid = f.key === 'temperatureLayer' && isInvalidTempLayer(val);

        // 行号列
        if (f.key === 'rowIndex') {
          let color = 'default';
          if (isDup) color = 'warning';
          if (isDbDup) color = 'error';
          return (
            <div>
              <Tag color={color}>{val}</Tag>
              {isDup && <Tag color="warning" style={{ fontSize: 9 }}>批次重复</Tag>}
              {isDbDup && <Tag color="error" style={{ fontSize: 9 }}>已存在</Tag>}
            </div>
          );
        }

        // 编辑态
        if (isEditing) {
          return (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={handleCellSave}
              onKeyDown={handleKeyDown}
              size="small"
              status={err || isTempInvalid ? 'error' : undefined}
              style={{ width: '100%' }}
            />
          );
        }

        // 查看态
        const bgColor = err ? '#fff2f0'
          : isTempInvalid ? '#fff7e6'
          : isDbDup ? '#fff1f0'
          : isDup ? '#fffbe6'
          : 'transparent';

        const borderColor = err ? '#ff4d4f'
          : isTempInvalid ? '#fa8c16'
          : isDbDup ? '#ff4d4f'
          : 'transparent';

        return (
          <Tooltip title={err?.message || (isTempInvalid ? `温层值"${val}"不在合法范围内` : undefined)}>
            <div
              style={{
                minHeight: 24,
                cursor: f.editable ? 'text' : 'default',
                padding: '2px 4px',
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {err && <Tag color="red" style={{ fontSize: 9, marginRight: 2 }}>错</Tag>}
              {isTempInvalid && !err && <Tag color="warning" style={{ fontSize: 9, marginRight: 2 }}>温层</Tag>}
              {val || (f.editable ? <span style={{ color: '#d9d9d9' }}>点击编辑</span> : '-')}
            </div>
          </Tooltip>
        );
      },
    }))
  , [fields, editingCell, editValue, handleCellClick, handleCellSave, handleKeyDown,
     getErrorFor, isRowDuplicate, isCellDbDuplicate, isInvalidTempLayer]);

  // 操作列
  const actionColumn = useMemo(() => ({
    key: '_actions',
    title: '操作',
    width: 100,
    fixed: 'right' as const,
    render: (_: any, record: any) => (
      <a onClick={() => handleDelete(record._rawIdx)} style={{ color: '#ff4d4f' }}>删除</a>
    ),
  }), [handleDelete]);

  return (
    <div>
      {/* 工具栏 */}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a onClick={handleAdd} style={{ color: '#0fc6c2' }}>+ 新增空行</a>
        <Button size="small" type="primary" ghost onClick={handleExport}>
          导出 Excel
        </Button>
      </div>

      {/* 样式：重复行和错误行高亮 */}
      <style>{`
        .row-duplicate > td { background: #fffbe6 !important; }
        .row-has-error > td { background: #fff2f0 !important; }
        .ant-table-cell { padding: 2px 4px !important; }
      `}</style>

      <div style={{ overflowX: 'auto', border: '1px solid #e5e6eb', borderRadius: 8 }}>
        <Table
          columns={[...columns, actionColumn]}
          dataSource={displayData}
          rowKey="_rawIdx"
          rowClassName={rowClassName}
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

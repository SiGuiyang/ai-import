'use client';

import { useState } from 'react';
import { Form, Input, Select, Button, Space, Card, Divider, Collapse, message, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import type { ParseRule, ColumnMapping, TailExtraction, TransposeConfig, SourceArea } from '@/lib/types';
import { updateRule } from '@/lib/rule-store';

const { TextArea } = Input;
const { Panel } = Collapse;

interface Props {
  initialRule: ParseRule;
  file: File | null;
  onSave: (rule: ParseRule) => void;
  onCancel: () => void;
}

export default function RuleEditor({ initialRule, file, onSave, onCancel }: Props) {
  const [rule, setRule] = useState<ParseRule>({ ...initialRule });

  const updateField = (field: string, value: any) => {
    setRule(prev => ({ ...prev, [field]: value }));
  };

  const updateSourceArea = (field: string, value: any) => {
    setRule(prev => ({
      ...prev,
      sourceArea: { ...prev.sourceArea, [field]: value },
    }));
  };

  const updateMapping = (idx: number, field: string, value: any) => {
    const mappings = [...rule.columnMappings];
    mappings[idx] = { ...mappings[idx], [field]: value };
    setRule(prev => ({ ...prev, columnMappings: mappings }));
  };

  const addMapping = () => {
    setRule(prev => ({
      ...prev,
      columnMappings: [
        ...prev.columnMappings,
        { targetField: '', sourceType: 'column', sourceKey: '', sourceIndex: -1, defaultValue: '', required: false },
      ],
    }));
  };

  const removeMapping = (idx: number) => {
    setRule(prev => ({
      ...prev,
      columnMappings: prev.columnMappings.filter((_, i) => i !== idx),
    }));
  };

  const updateTail = (idx: number, field: string, value: any) => {
    const tails = [...(rule.tailExtractions || [])];
    tails[idx] = { ...tails[idx], [field]: value };
    setRule(prev => ({ ...prev, tailExtractions: tails }));
  };

  const addTail = () => {
    setRule(prev => ({
      ...prev,
      tailExtractions: [...(prev.tailExtractions || []), { field: '', rowMarker: '', columnIndex: 0 }],
    }));
  };

  const removeTail = (idx: number) => {
    setRule(prev => ({
      ...prev,
      tailExtractions: prev.tailExtractions.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = () => {
    if (!rule.name.trim()) {
      message.warning('请输入规则名称');
      return;
    }
    if (rule.columnMappings.length === 0) {
      message.warning('请至少添加一个字段映射');
      return;
    }
    const now = new Date().toISOString();
    const updatedRule = { ...rule, updatedAt: now };
    updateRule(rule.id, updatedRule);
    onSave(updatedRule);
  };

  const targetFieldOptions = [
    { label: '外部编码', value: 'externalCode' },
    { label: '收货门店', value: 'receiverStore' },
    { label: '收件人姓名', value: 'receiverName' },
    { label: '收件人电话', value: 'receiverPhone' },
    { label: '收件人地址', value: 'receiverAddress' },
    { label: 'SKU编码', value: 'skuCode' },
    { label: 'SKU名称', value: 'skuName' },
    { label: '发货数量', value: 'skuQuantity' },
    { label: '规格型号', value: 'skuSpec' },
    { label: '备注', value: 'remark' },
  ];

  return (
    <div>
      <Form layout="vertical">
        <Form.Item label="规则名称">
          <Input value={rule.name} onChange={e => updateField('name', e.target.value)} />
        </Form.Item>

        <Form.Item label="文件类型">
          <Select
            value={rule.fileType}
            onChange={v => updateField('fileType', v)}
            options={[
              { label: 'Excel', value: 'excel' },
              { label: 'Word', value: 'word' },
              { label: 'PDF', value: 'pdf' },
            ]}
          />
        </Form.Item>

        <Divider>源区域配置</Divider>

        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Form.Item label="Sheet模式" style={{ marginBottom: 0 }}>
              <Select
                value={rule.sourceArea.sheetMode}
                onChange={v => updateSourceArea('sheetMode', v)}
                style={{ width: 120 }}
                options={[
                  { label: '首个', value: 'first' },
                  { label: '全部', value: 'all' },
                  { label: '按名称', value: 'named' },
                  { label: '按索引', value: 'index' },
                ]}
              />
            </Form.Item>
            <Form.Item label="跳过头部行数" style={{ marginBottom: 0 }}>
              <Input
                type="number"
                value={rule.sourceArea.headerSkipRows}
                onChange={e => updateSourceArea('headerSkipRows', parseInt(e.target.value) || 0)}
                style={{ width: 80 }}
              />
            </Form.Item>
            <Form.Item label="表头行号" style={{ marginBottom: 0 }}>
              <Input
                type="number"
                value={rule.sourceArea.headerRowIndex}
                onChange={e => updateSourceArea('headerRowIndex', parseInt(e.target.value) || 1)}
                style={{ width: 80 }}
              />
            </Form.Item>
            <Form.Item label="数据起始行" style={{ marginBottom: 0 }}>
              <Input
                type="number"
                value={rule.sourceArea.dataStartRow}
                onChange={e => updateSourceArea('dataStartRow', parseInt(e.target.value) || 0)}
                style={{ width: 80 }}
              />
            </Form.Item>
          </Space>

          <Form.Item label="数据结束标记（可选）">
            <Input
              value={rule.sourceArea.dataEndMarker || ''}
              onChange={e => updateSourceArea('dataEndMarker', e.target.value)}
              placeholder="如：合计、小计、总计"
            />
          </Form.Item>
        </Space>

        <Divider>字段映射</Divider>

        {rule.columnMappings.map((m, idx) => (
          <Card key={idx} size="small" style={{ marginBottom: 8 }}>
            <Space align="start" style={{ width: '100%' }}>
              <Form.Item label="目标字段" style={{ marginBottom: 0 }}>
                <Select
                  value={m.targetField}
                  onChange={v => updateMapping(idx, 'targetField', v)}
                  style={{ width: 140 }}
                  options={targetFieldOptions}
                />
              </Form.Item>
              <Form.Item label="源类型" style={{ marginBottom: 0 }}>
                <Select
                  value={m.sourceType}
                  onChange={v => updateMapping(idx, 'sourceType', v)}
                  style={{ width: 100 }}
                  options={[
                    { label: '列', value: 'column' },
                    { label: '行', value: 'row' },
                    { label: '固定值', value: 'value' },
                  ]}
                />
              </Form.Item>
              {m.sourceType === 'column' && (
                <Form.Item label="列名关键词" style={{ marginBottom: 0 }}>
                  <Input
                    value={m.sourceKey || ''}
                    onChange={e => updateMapping(idx, 'sourceKey', e.target.value)}
                    placeholder="模糊匹配列名"
                    style={{ width: 140 }}
                  />
                </Form.Item>
              )}
              {m.sourceType === 'row' && (
                <Form.Item label="行标志" style={{ marginBottom: 0 }}>
                  <Input
                    value={m.sourceKey || ''}
                    onChange={e => updateMapping(idx, 'sourceKey', e.target.value)}
                    placeholder="行文本标志"
                    style={{ width: 140 }}
                  />
                </Form.Item>
              )}
              {m.sourceType === 'value' && (
                <Form.Item label="默认值" style={{ marginBottom: 0 }}>
                  <Input
                    value={m.defaultValue || ''}
                    onChange={e => updateMapping(idx, 'defaultValue', e.target.value)}
                    style={{ width: 140 }}
                  />
                </Form.Item>
              )}
              <Form.Item label="列序号" style={{ marginBottom: 0 }}>
                <Input
                  type="number"
                  value={m.sourceIndex !== undefined ? m.sourceIndex : -1}
                  onChange={e => updateMapping(idx, 'sourceIndex', parseInt(e.target.value) || -1)}
                  style={{ width: 80 }}
                />
              </Form.Item>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeMapping(idx)}
                style={{ marginTop: 24 }}
              />
            </Space>
          </Card>
        ))}
        <Button type="dashed" onClick={addMapping} icon={<PlusOutlined />} block>
          添加字段映射
        </Button>

        <Divider>尾部信息提取</Divider>

        {(rule.tailExtractions || []).map((t, idx) => (
          <Card key={idx} size="small" style={{ marginBottom: 8 }}>
            <Space>
              <Form.Item label="目标字段" style={{ marginBottom: 0 }}>
                <Select
                  value={t.field}
                  onChange={v => updateTail(idx, 'field', v)}
                  style={{ width: 140 }}
                  options={targetFieldOptions}
                />
              </Form.Item>
              <Form.Item label="行标志" style={{ marginBottom: 0 }}>
                <Input
                  value={t.rowMarker}
                  onChange={e => updateTail(idx, 'rowMarker', e.target.value)}
                  placeholder="行文本标志"
                  style={{ width: 160 }}
                />
              </Form.Item>
              <Form.Item label="列序号" style={{ marginBottom: 0 }}>
                <Input
                  type="number"
                  value={t.columnIndex}
                  onChange={e => updateTail(idx, 'columnIndex', parseInt(e.target.value) || 0)}
                  style={{ width: 80 }}
                />
              </Form.Item>
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeTail(idx)}
                style={{ marginTop: 24 }}
              />
            </Space>
          </Card>
        ))}
        <Button type="dashed" onClick={addTail} icon={<PlusOutlined />} block>
          添加尾部提取
        </Button>

        <Divider>高级配置</Divider>

        <Collapse ghost>
          <Panel header="矩阵转置" key="transpose">
            <Form.Item label="维度列头（逗号分隔）">
              <Input
                value={rule.transpose?.dimensionHeaders?.join(', ') || ''}
                onChange={e => {
                  const headers = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  setRule(prev => ({
                    ...prev,
                    transpose: { ...prev.transpose!, dimensionHeaders: headers, dimensionField: prev.transpose?.dimensionField || '', valueField: prev.transpose?.valueField || '' },
                  }));
                }}
              />
            </Form.Item>
            <Form.Item label="维度字段">
              <Select
                value={rule.transpose?.dimensionField}
                onChange={v => setRule(prev => ({ ...prev, transpose: { ...prev.transpose!, dimensionField: v, dimensionHeaders: prev.transpose?.dimensionHeaders || [], valueField: prev.transpose?.valueField || '' } }))}
                options={targetFieldOptions}
                style={{ width: 200 }}
              />
            </Form.Item>
            <Form.Item label="值字段">
              <Select
                value={rule.transpose?.valueField}
                onChange={v => setRule(prev => ({ ...prev, transpose: { ...prev.transpose!, valueField: v, dimensionHeaders: prev.transpose?.dimensionHeaders || [], dimensionField: prev.transpose?.dimensionField || '' } }))}
                options={targetFieldOptions}
                style={{ width: 200 }}
              />
            </Form.Item>
          </Panel>
          <Panel header="卡片式解析" key="cardSplit">
            <Form.Item label="卡片起始标志">
              <Input
                value={rule.cardSplit?.startMarker || ''}
                onChange={e => setRule(prev => ({ ...prev, cardSplit: { ...prev.cardSplit!, startMarker: e.target.value, tableRowsAfterMarker: prev.cardSplit?.tableRowsAfterMarker || 5 } }))}
              />
            </Form.Item>
          </Panel>
          <Panel header="复合单元格拆分" key="cellSplit">
            <Form.Item label="目标列">
              <Input
                value={rule.cellSplit?.column || ''}
                onChange={e => setRule(prev => ({ ...prev, cellSplit: { ...prev.cellSplit!, column: e.target.value, pattern: prev.cellSplit?.pattern || '(.+?)x(\\d+)', targetFields: ['skuName', 'skuQuantity'] } }))}
              />
            </Form.Item>
          </Panel>
          <Panel header="聚合配置" key="group">
            <Form.Item label="按字段聚合">
              <Select
                value={rule.groupBy || ''}
                onChange={v => updateField('groupBy', v)}
                options={[{ label: '不聚合', value: '' }, ...targetFieldOptions]}
                style={{ width: 200 }}
              />
            </Form.Item>
            <Form.Item label="跳过的行正则（逗号分隔）">
              <Input
                value={(rule.skipLinesRegex || []).join(', ')}
                onChange={e => updateField('skipLinesRegex', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              />
            </Form.Item>
          </Panel>
        </Collapse>

        <Divider />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleSave}>保存规则</Button>
        </div>
      </Form>
    </div>
  );
}

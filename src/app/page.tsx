'use client';

import { useState, useRef } from 'react';
import {
  Upload, Button, Select, Card, message, Typography, Spin, Space,
  Modal, Input, Steps, Progress, Table, Alert, Tag, Tooltip, App
} from 'antd';
import {
  UploadOutlined, InboxOutlined, PlusOutlined, DownloadOutlined,
  DeleteOutlined, EditOutlined, EyeOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ArrowLeftOutlined
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import type { ParseRule } from '@/lib/types';
import { getRules, createRule } from '@/lib/rule-store';
import { detectFileType } from '@/lib/utils';
import { validateRecords } from '@/lib/validators';
import DataTable from '@/components/DataTable';
import RuleEditor from '@/components/RuleEditor';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<string>('');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [showNewRuleModal, setShowNewRuleModal] = useState(false);
  const [aiGeneratedRule, setAiGeneratedRule] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [filePreview, setFilePreview] = useState('');
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([]);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [editingData, setEditingData] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState('');
  const [newRuleName, setNewRuleName] = useState('');
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [ruleToEdit, setRuleToEdit] = useState<any>(null);

  const refreshRules = async () => {
    const allRules = await getRules();
    setRules(allRules);
  };

  const handleFileSelect = (file: File) => {
    setFile(file);
    const dt = detectFileType(file.name);
    setFileType(dt || '');
    setStep(2);
    setSelectedRuleId('');
    setParsedData([]);
    setParseError('');
    refreshRules();
    return false;
  };

  const handleNewRule = async () => {
    if (!file) return;
    setAiLoading(true);
    setShowNewRuleModal(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.rule) {
        setAiGeneratedRule(data.rule);
        setFilePreview(data.filePreview || '');
      } else {
        message.error(data.error || 'AI 生成规则失败');
      }
    } catch (e: any) {
      message.error('AI 请求失败: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSaveAiRule = async () => {
    if (!aiGeneratedRule || !newRuleName.trim()) {
      message.warning('请输入规则名称');
      return;
    }

    const now = new Date().toISOString();
    const rule: ParseRule = {
      id: uuidv4(),
      name: newRuleName.trim(),
      fileType: aiGeneratedRule.fileType || fileType,
      description: aiGeneratedRule.description || '',
      sourceArea: aiGeneratedRule.sourceArea || { sheetMode: 'first', headerSkipRows: 0, headerRowIndex: 1, dataStartRow: 2 },
      columnMappings: aiGeneratedRule.columnMappings || [],
      tailExtractions: aiGeneratedRule.tailExtractions || [],
      transpose: aiGeneratedRule.transpose || undefined,
      cardSplit: aiGeneratedRule.cardSplit || undefined,
      cellSplit: aiGeneratedRule.cellSplit || undefined,
      groupBy: aiGeneratedRule.groupBy || undefined,
      skipLinesRegex: aiGeneratedRule.skipLinesRegex || undefined,
      aiGenerated: true,
      confidence: aiGeneratedRule.confidence || 0.7,
      warnings: aiGeneratedRule.warnings || [],
      createdAt: now,
      updatedAt: now,
    };

    await createRule(rule);
    message.success('规则已保存');
    setSelectedRuleId(rule.id);
    setShowNewRuleModal(false);
    setShowRuleEditor(true);
    setRuleToEdit(rule);
    await refreshRules();
  };

  const handleParse = async () => {
    if (!file || !selectedRuleId) {
      message.warning('请选择文件并选择或创建规则');
      return;
    }

    const rule = rules.find(r => r.id === selectedRuleId);
    if (!rule) {
      message.error('规则不存在');
      return;
    }

    setLoading(true);
    setProgress({ current: 0, total: 100, percent: 0 });
    setParseError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('rule', JSON.stringify(rule));

      const res = await fetch('/api/parse', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setParsedData(data.data || []);
        setEditingData(data.data || []);
        setProgress({ current: data.totalRows, total: data.totalRows, percent: 100 });
        setTimeout(() => setStep(3), 500);

        const { errors, groupDuplicateWarning } = validateRecords(data.data || []);
        setValidationErrors(errors);
        setDuplicateWarnings(groupDuplicateWarning);
      } else {
        setParseError(data.error || '解析失败');
        message.error(data.error || '解析失败');
      }
    } catch (e: any) {
      setParseError(e.message);
      message.error('解析请求失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDataChange = (newData: Record<string, unknown>[]) => {
    setEditingData(newData);
    const { errors, groupDuplicateWarning } = validateRecords(newData);
    setValidationErrors(errors);
    setDuplicateWarnings(groupDuplicateWarning);
  };

  const handleExport = () => {
    if (editingData.length === 0) {
      message.warning('没有数据可导出');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(editingData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `export_${Date.now()}.xlsx`);
    message.success('导出成功');
  };

  const handleSubmit = async () => {
    const { errors } = validateRecords(editingData);
    if (errors.length > 0) {
      message.error(`有 ${errors.length} 个错误需要修正后才能提交`);
      setValidationErrors(errors);
      return;
    }

    setSubmitLoading(true);
    setProgress({ current: 0, total: editingData.length, percent: 0 });

    try {
      const batchId = `BATCH_${Date.now()}`;
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: editingData, batchId }),
      });

      const result = await res.json();
      setSubmitResult(result);
      setProgress({ current: result.successCount, total: editingData.length, percent: 100 });

      if (result.successCount > 0) {
        message.success(`成功提交 ${result.successCount} 条`);
        setTimeout(() => setStep(4), 500);
      } else {
        message.error('提交失败');
      }
    } catch (e: any) {
      message.error('提交失败: ' + e.message);
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleRuleEditSave = (updatedRule: ParseRule) => {
    setRuleToEdit(updatedRule);
    setShowRuleEditor(false);
    setSelectedRuleId(updatedRule.id);
    message.success('规则已更新');
  };

  const handleBackToFile = () => {
    setStep(1);
    setFile(null);
    setParsedData([]);
    setEditingData([]);
    setSubmitResult(null);
    setValidationErrors([]);
  };

  const stepItems = [
    { title: '上传文件' },
    { title: '选择规则' },
    { title: '预览编辑' },
    { title: '完成' },
  ];

  const hasErrors = validationErrors.length > 0 || duplicateWarnings.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, background: 'linear-gradient(135deg, #0fc6c2, #0bada9)',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 18
          }}>导</div>
          <div>
            <Title level={4} style={{ margin: 0, color: '#1d2129' }}>万能导入 V2</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>智能多格式批量下单系统</Text>
          </div>
          <div style={{ flex: 1 }} />
          <Button type="link" onClick={() => router.push('/orders')}>
            已导入运单
          </Button>
          <Button type="link" onClick={() => router.push('/rules')}>
            规则管理
          </Button>
        </div>

        <Card style={{ marginBottom: 24 }}>
          <Steps current={step - 1} items={stepItems} size="small" />
        </Card>

        {/* Step 1: Upload File */}
        {step === 1 && (
          <Card>
            <Title level={5}>上传出库单文件</Title>
            <Text type="secondary">支持 Excel (.xlsx/.xls)、Word (.docx)、PDF 格式</Text>
            <div style={{ marginTop: 16 }}>
              <Dragger
                accept=".xlsx,.xls,.docx,.pdf"
                beforeUpload={(file) => { handleFileSelect(file); return false; }}
                showUploadList={false}
                style={{ padding: 24 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">支持 Excel (.xlsx/.xls)、Word (.docx)、PDF 格式</p>
              </Dragger>
            </div>
          </Card>
        )}

        {/* Step 2: Select or Create Rule */}
        {step === 2 && (
          <Card>
            {parseError && (
              <Alert type="error" message={parseError} style={{ marginBottom: 16 }}
                description="解析失败，请检查规则配置是否正确。"
                showIcon
              />
            )}
            <Title level={5}>选择解析规则</Title>
            <Text type="secondary">文件: {file?.name}</Text>
            <div style={{ marginTop: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择已有规则"
                  value={selectedRuleId || undefined}
                  onChange={setSelectedRuleId}
                  options={rules.filter(r => r.fileType === fileType).map(r => ({
                    label: `${r.name}${r.aiGenerated ? ' (AI生成)' : ''}`,
                    value: r.id,
                  }))}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button icon={<PlusOutlined />} onClick={handleNewRule} loading={aiLoading}>
                    AI 辅助新建规则
                  </Button>
                  <Button
                    icon={<EditOutlined />}
                    disabled={!selectedRuleId}
                    onClick={() => {
                      const rule = rules.find(r => r.id === selectedRuleId);
                      if (rule) {
                        setRuleToEdit(rule);
                        setShowRuleEditor(true);
                      }
                    }}
                  >
                    编辑规则
                  </Button>
                </div>
              </Space>
            </div>
            <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
              <Button onClick={() => setStep(1)} icon={<ArrowLeftOutlined />}>返回</Button>
              <Button type="primary" onClick={handleParse} disabled={!selectedRuleId} loading={loading}>
                执行解析
              </Button>
            </div>
            {loading && (
              <div style={{ marginTop: 16 }}>
                <Progress percent={progress.percent} />
                <Text type="secondary">解析中... 已处理 {progress.current} 行</Text>
              </div>
            )}
          </Card>
        )}

        {/* Step 3: Preview & Edit */}
        {step === 3 && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <Title level={5} style={{ margin: 0 }}>数据预览与编辑</Title>
                <Text type="secondary">共 {editingData.length} 条记录</Text>
              </div>
              <Space>
                <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 Excel</Button>
                <Button
                  type="primary"
                  onClick={handleSubmit}
                  loading={submitLoading}
                  disabled={hasErrors}
                >
                  提交下单
                </Button>
              </Space>
            </div>

            {validationErrors.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={`发现 ${validationErrors.length} 个数据错误需要修正`}
                style={{ marginBottom: 12 }}
              />
            )}

            {duplicateWarnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="外部编码重复检测"
                description={duplicateWarnings.map((w, i) => <div key={i}>{w}</div>)}
                style={{ marginBottom: 12 }}
              />
            )}

            {submitLoading && (
              <div style={{ marginBottom: 16 }}>
                <Progress percent={Math.round((progress.current / progress.total) * 100)} />
                <Text type="secondary">提交中... {progress.current}/{progress.total}</Text>
              </div>
            )}

            <DataTable
              data={editingData}
              onChange={handleDataChange}
              validationErrors={validationErrors}
              duplicateWarnings={duplicateWarnings}
            />

            {submitResult && (
              <Alert
                type={submitResult.successCount > 0 ? 'success' : 'error'}
                message={`提交结果：成功 ${submitResult.successCount} 条`}
                description={submitResult.errors?.length > 0 ? submitResult.errors.join('\n') : ''}
                style={{ marginTop: 16 }}
              />
            )}
          </Card>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              {submitResult?.successCount > 0 ? (
                <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
              ) : (
                <CloseCircleOutlined style={{ fontSize: 64, color: '#ff4d4f' }} />
              )}
              <Title level={4} style={{ marginTop: 16 }}>
                {submitResult?.successCount > 0 ? '提交成功' : '提交失败'}
              </Title>
              <Text>成功 {submitResult?.successCount || 0} 条，失败 {submitResult?.failCount || 0} 条</Text>
              <br />
              <Text type="secondary">批次号: {submitResult?.batchId}</Text>
              <div style={{ marginTop: 24 }}>
                <Space>
                  <Button onClick={handleBackToFile} icon={<UploadOutlined />}>继续导入</Button>
                  <Button onClick={() => router.push('/orders')} type="primary">
                    查看运单列表
                  </Button>
                </Space>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* AI Rule Generation Modal */}
      <Modal
        title="AI 辅助创建规则"
        open={showNewRuleModal}
        onCancel={() => { setShowNewRuleModal(false); setAiGeneratedRule(null); }}
        width={720}
        footer={null}
        destroyOnHidden
      >
        {aiLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>AI 正在分析文件结构...</div>
          </div>
        ) : aiGeneratedRule ? (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>规则名称：</Text>
              <Input
                placeholder="输入规则名称"
                value={newRuleName}
                onChange={e => setNewRuleName(e.target.value)}
                style={{ width: 300, marginLeft: 8 }}
              />
            </div>

            {aiGeneratedRule.warnings && aiGeneratedRule.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="AI 推测标注"
                description={aiGeneratedRule.warnings.map((w: string, i: number) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              />
            )}

            <div style={{ marginBottom: 12 }}>
              <Text strong>文件预览：</Text>
              <pre style={{
                background: '#f5f5f5', padding: 12, borderRadius: 8,
                maxHeight: 160, overflow: 'auto', fontSize: 12, marginTop: 8
              }}>
                {filePreview || '无预览'}
              </pre>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Text strong>AI 生成的规则配置：</Text>
              <pre style={{
                background: '#f5f5f5', padding: 12, borderRadius: 8,
                maxHeight: 300, overflow: 'auto', fontSize: 12, marginTop: 8
              }}>
                {JSON.stringify(aiGeneratedRule, null, 2)}
              </pre>
            </div>

            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <Space>
                <Button onClick={() => setShowNewRuleModal(false)}>取消</Button>
                <Button type="primary" onClick={handleSaveAiRule}>确认保存规则</Button>
              </Space>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Rule Editor Modal */}
      <Modal
        title="编辑解析规则"
        open={showRuleEditor}
        onCancel={() => setShowRuleEditor(false)}
        width={800}
        footer={null}
        destroyOnClose
      >
        {ruleToEdit && (
          <RuleEditor
            initialRule={ruleToEdit}
            file={file}
            onSave={handleRuleEditSave}
            onCancel={() => setShowRuleEditor(false)}
          />
        )}
      </Modal>
    </div>
  );
}

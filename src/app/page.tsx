'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Button, Select, Card, message, Typography, Spin, Space,
  Modal, Input, Steps, Progress, Alert, Tag,
  Result, Descriptions, Statistic, Segmented, Divider
} from 'antd';
import {
  InboxOutlined, PlusOutlined, DownloadOutlined,
  EditOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ArrowLeftOutlined, RobotOutlined,
  ThunderboltOutlined, FileTextOutlined, SafetyCertificateOutlined,
  ReloadOutlined, ExclamationCircleOutlined, BulbOutlined,
  PlayCircleOutlined
} from '@ant-design/icons';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import { getRules, createRule } from '@/lib/rule-store';
import type { ParseRule } from '@/lib/types';
import { detectFileType } from '@/lib/utils';
import { validateRecords } from '@/lib/validators';
import DataTable from '@/components/DataTable';
import RuleEditor from '@/components/RuleEditor';

const { Title, Text } = Typography;
const { Dragger } = Upload;
const { TextArea } = Input;

type ParseMode = 'auto' | 'rule' | 'ai-direct';

export default function HomePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<string>('');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const fileRef = useRef<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0, statusText: '' });
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
  const [parseMode, setParseMode] = useState<ParseMode>('auto');
  const [aiAnalysisStatus, setAiAnalysisStatus] = useState<'idle' | 'analyzing' | 'generating-rule' | 'parsing' | 'done' | 'error'>('idle');
  const [ruleSelectionMode, setRuleSelectionMode] = useState<'existing' | 'ai-generate'>('existing');

  useEffect(() => {
    getRules().then(setRules).catch(() => {});
  }, []);

  const refreshRules = async () => {
    const allRules = await getRules();
    setRules(allRules);
  };

  // === 一键 AI 自动分析流程 ===
  const startAutoAnalysis = async (uploadFile: File) => {
    setAiAnalysisStatus('analyzing');
    setProgress({ current: 1, total: 3, percent: 33, statusText: '正在读取文件内容...' });

    try {
      // 第1步：调用 AI 生成规则
      setAiAnalysisStatus('generating-rule');
      setProgress({ current: 1, total: 3, percent: 33, statusText: 'AI 正在分析文件格式...' });

      const formData = new FormData();
      formData.append('file', uploadFile);

      const ruleRes = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        body: formData,
      });
      const ruleData = await ruleRes.json();

      if (!ruleData.rule) {
        setProgress({ current: 1, total: 3, percent: 33, statusText: 'AI 规则生成失败，尝试直接解析...' });
        await startDirectParse(uploadFile);
        return;
      }

      const aiRule = ruleData.rule;
      setFilePreview(ruleData.filePreview || '');
      setAiGeneratedRule(aiRule);

      const now = new Date().toISOString();
      const savedRule: ParseRule = {
        id: uuidv4(),
        name: aiRule.name || `AI规则-${uploadFile.name}`,
        fileType: aiRule.fileType || detectFileType(uploadFile.name) || 'excel',
        description: aiRule.description || '',
        sourceArea: aiRule.sourceArea || { sheetMode: 'first', headerSkipRows: 0, headerRowIndex: 1, dataStartRow: 2 },
        columnMappings: aiRule.columnMappings || [],
        tailExtractions: aiRule.tailExtractions || [],
        transpose: aiRule.transpose || undefined,
        cardSplit: aiRule.cardSplit || undefined,
        cellSplit: aiRule.cellSplit || undefined,
        groupBy: aiRule.groupBy || undefined,
        skipLinesRegex: aiRule.skipLinesRegex || undefined,
        aiGenerated: true,
        confidence: aiRule.confidence || 0.7,
        warnings: aiRule.warnings || [],
        createdAt: now,
        updatedAt: now,
      };

      await createRule(savedRule);

      setAiAnalysisStatus('parsing');
      setProgress({ current: 2, total: 3, percent: 66, statusText: '正在解析数据...' });

      const parseFormData = new FormData();
      parseFormData.append('file', uploadFile);
      parseFormData.append('rule', JSON.stringify(savedRule));

      const parseRes = await fetch('/api/parse', {
        method: 'POST',
        body: parseFormData,
      });
      const parseData = await parseRes.json();

      if (parseData.success && parseData.data && parseData.data.length > 0) {
        setParsedData(parseData.data);
        setEditingData(parseData.data);
        setParseMode('rule');
        setSelectedRuleId(savedRule.id);
        finishAnalysis(parseData.data);
      } else {
        setProgress({ current: 2, total: 3, percent: 66, statusText: '规则解析未获得有效数据，尝试AI直接解析...' });
        await startDirectParse(uploadFile);
      }
    } catch (e: any) {
      try {
        await startDirectParse(uploadFile);
      } catch (e2: any) {
        setAiAnalysisStatus('error');
        setParseError('AI 分析失败: ' + e2.message);
        message.error('AI 分析失败: ' + e2.message);
      }
    }
  };

  const startDirectParse = async (uploadFile: File) => {
    setAiAnalysisStatus('parsing');
    setProgress({ current: 2, total: 3, percent: 66, statusText: 'AI 正在直接提取数据...' });

    const formData = new FormData();
    formData.append('file', uploadFile);

    const res = await fetch('/api/ai/direct-parse', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (data.success && data.data && data.data.length > 0) {
      setParsedData(data.data);
      setEditingData(data.data);
      setParseMode('ai-direct');
      setFilePreview(data.filePreview || '');
      finishAnalysis(data.data);
    } else {
      setAiAnalysisStatus('error');
      setParseError(data.error || 'AI 无法解析此文件，请手动选择规则');
      setStep(2);
      refreshRules();
    }
  };

  const finishAnalysis = (data: Record<string, unknown>[]) => {
    setAiAnalysisStatus('done');
    setProgress({ current: 3, total: 3, percent: 100, statusText: '解析完成' });
    const { errors, groupDuplicateWarning } = validateRecords(data);
    setValidationErrors(errors);
    setDuplicateWarnings(groupDuplicateWarning);
    setTimeout(() => setStep(3), 600);
  };

  const handleFileSelect = (file: File) => {
    setFile(file);
    fileRef.current = file;
    const dt = detectFileType(file.name);
    setFileType(dt || '');
    setStep(2);
    setSelectedRuleId('');
    setParsedData([]);
    setParseError('');
    setAiAnalysisStatus('idle');
    setParseMode('auto');
    setRuleSelectionMode('existing');
    setAiGeneratedRule(null);
    setFilePreview('');
    return false;
  };

  // === AI 智能生成规则（Step 2 中调用，不自动解析） ===
  const handleAiGenerateRule = async () => {
    if (!file) return;
    setAiLoading(true);
    setAiAnalysisStatus('generating-rule');

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
        setAiAnalysisStatus('done');
      } else {
        setAiAnalysisStatus('error');
        setParseError(data.error || 'AI 生成规则失败');
        message.error(data.error || 'AI 生成规则失败');
      }
    } catch (e: any) {
      setAiAnalysisStatus('error');
      setParseError('AI 请求失败: ' + e.message);
      message.error('AI 请求失败: ' + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  // === 使用 AI 生成的规则执行解析 ===
  const handleParseWithAiRule = async () => {
    if (!file || !aiGeneratedRule) {
      message.warning('请先生成 AI 规则');
      return;
    }

    const now = new Date().toISOString();
    const savedRule: ParseRule = {
      id: uuidv4(),
      name: aiGeneratedRule.name || `AI规则-${file.name}`,
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

    // 先保存规则
    await createRule(savedRule);
    setSelectedRuleId(savedRule.id);
    await refreshRules();

    // 然后执行解析
    setLoading(true);
    setParseError('');

    try {
      const parseFormData = new FormData();
      parseFormData.append('file', file);
      parseFormData.append('rule', JSON.stringify(savedRule));

      const parseRes = await fetch('/api/parse', {
        method: 'POST',
        body: parseFormData,
      });
      const parseData = await parseRes.json();

      if (parseData.success && parseData.data && parseData.data.length > 0) {
        setParsedData(parseData.data);
        setEditingData(parseData.data);
        setParseMode('rule');
        setProgress({ current: parseData.totalRows, total: parseData.totalRows, percent: 100, statusText: '解析完成' });

        const { errors, groupDuplicateWarning } = validateRecords(parseData.data);
        setValidationErrors(errors);
        setDuplicateWarnings(groupDuplicateWarning);
        setTimeout(() => setStep(3), 500);
      } else {
        setParseError(parseData.error || 'AI规则解析未获得有效数据，请尝试手动选择规则');
        message.warning(parseData.error || 'AI规则解析未获得有效数据');
      }
    } catch (e: any) {
      setParseError(e.message);
      message.error('解析请求失败: ' + e.message);
    } finally {
      setLoading(false);
    }
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
    setProgress({ current: 0, total: 100, percent: 0, statusText: '解析中...' });
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
        setParseMode('rule');
        setProgress({ current: data.totalRows, total: data.totalRows, percent: 100, statusText: '解析完成' });

        const { errors, groupDuplicateWarning } = validateRecords(data.data || []);
        setValidationErrors(errors);
        setDuplicateWarnings(groupDuplicateWarning);
        setTimeout(() => setStep(3), 500);
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

  // === 异步上传（走 /api/import-tasks 管道） ===
  const handleAsyncUpload = async () => {
    const f = fileRef.current;
    if (!f) {
      message.warning('请先选择文件');
      return;
    }
    if (uploading) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', f);

      const res = await fetch('/api/import-tasks', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        message.error(data.message || '上传失败');
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
    setProgress({ current: 0, total: editingData.length, percent: 0, statusText: '提交中...' });

    try {
      const batchId = `BATCH_${Date.now()}`;
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: editingData, batchId }),
      });

      const result = await res.json();
      setSubmitResult(result);
      setProgress({ current: result.successCount, total: editingData.length, percent: 100, statusText: '提交完成' });

      if (result.successCount > 0) {
        message.success(`成功提交 ${result.successCount} 条运单`);
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
    setRuleSelectionMode('existing');
    message.success('规则已保存，请在「已有规则」中执行解析');
  };

  const handleBackToFile = () => {
    setStep(1);
    setFile(null);
    fileRef.current = null;
    setParsedData([]);
    setEditingData([]);
    setSubmitResult(null);
    setValidationErrors([]);
    setAiAnalysisStatus('idle');
    setParseError('');
  };

  const handleRetryAutoAnalysis = () => {
    if (file) {
      setParseError('');
      startAutoAnalysis(file);
    }
  };

  const stepItems = [
    { title: '上传文件' },
    { title: '选择规则' },
    { title: '预览编辑' },
    { title: '完成' },
  ];

  const hasErrors = validationErrors.length > 0 || duplicateWarnings.length > 0;
  const validCount = editingData.filter(r => r.skuCode && r.skuName && r.skuQuantity).length;
  const errorCount = validationErrors.length;
  const uniqueStores = new Set(editingData.map(r => r.receiverStore).filter(Boolean)).size;

  return (
    <div style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{
            width: 40, height: 40, background: 'linear-gradient(135deg, #0fc6c2, #0bada9)',
            borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: 18
          }}>导</div>
          <div>
            <Title level={4} style={{ margin: 0, color: '#1d2129' }}>万能导入 V2</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>AI智能分析 · 一键批量下单</Text>
          </div>
          <div style={{ flex: 1 }} />
          <Button type="link" onClick={() => router.push('/orders')}>
            已导入运单
          </Button>
          <Button type="link" onClick={() => router.push('/rules')}>
            规则管理
          </Button>
          <Button type="link" onClick={() => router.push('/credentials')}>
            凭证管理
          </Button>
          <Button type="link" onClick={() => router.push('/import-tasks')}>
            导入任务
          </Button>
          <Button type="link" onClick={() => router.push('/monitor')}>
            监控看板
          </Button>
        </div>

        <Card style={{ marginBottom: 24 }}>
          <Steps current={step - 1} items={stepItems} size="small" />
        </Card>

        {/* Step 1: Upload File */}
        {step === 1 && (
          <Card>
            <Title level={5}>
              <ThunderboltOutlined style={{ color: '#0fc6c2', marginRight: 8 }} />
              上传出库单文件
            </Title>
            <Text type="secondary">上传文件后，AI 将自动分析文件格式并生成解析规则，自动提取数据</Text>
            <div style={{ marginTop: 16 }}>
              <Dragger
                accept=".xlsx,.xls,.docx,.pdf,.csv"
                beforeUpload={(f) => { handleFileSelect(f); return false; }}
                showUploadList={false}
                style={{ padding: 32 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 48, color: '#0fc6c2' }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 16 }}>点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 Excel (.xlsx/.xls)、Word (.docx)、PDF、CSV 格式
                </p>
                <div style={{ marginTop: 12 }}>
                  <Space>
                    <Tag icon={<FileTextOutlined />} color="green">Excel</Tag>
                    <Tag icon={<FileTextOutlined />} color="blue">Word</Tag>
                    <Tag icon={<FileTextOutlined />} color="red">PDF</Tag>
                  </Space>
                </div>
              </Dragger>
            </div>
          </Card>
        )}

        {/* Step 2: 选择解析规则 */}
        {step === 2 && (
          <>
            {/* 文件信息条 */}
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileTextOutlined style={{ fontSize: 18, color: '#0fc6c2' }} />
                <Text strong style={{ fontSize: 15 }}>{file?.name}</Text>
                <Tag color="blue">{fileType?.toUpperCase()}</Tag>
                <div style={{ flex: 1 }} />
                <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setStep(1)}>
                  重新选择文件
                </Button>
              </div>
            </Card>

            {/* 解析方式选择 */}
            <Card
              title={
                <span>
                  <ThunderboltOutlined style={{ color: '#0fc6c2', marginRight: 8 }} />
                  选择解析方式
                </span>
              }
            >
              <Segmented
                value={ruleSelectionMode}
                onChange={(val) => {
                  setRuleSelectionMode(val as 'existing' | 'ai-generate');
                  setParseError('');
                  setAiGeneratedRule(null);
                  setAiAnalysisStatus('idle');
                }}
                options={[
                  { label: '已有规则', value: 'existing', icon: <FileTextOutlined /> },
                  { label: 'AI 智能生成', value: 'ai-generate', icon: <RobotOutlined /> },
                ]}
                block
                style={{ marginBottom: 24 }}
              />

              {/* === 模式一：选择已有规则 === */}
              {ruleSelectionMode === 'existing' && (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    从已保存的解析规则中选择一个，直接对文件进行解析
                  </Text>

                  <div style={{ maxWidth: 600 }}>
                    <Select
                      style={{ width: '100%', marginBottom: 12 }}
                      placeholder="请选择解析规则"
                      value={selectedRuleId || undefined}
                      onChange={setSelectedRuleId}
                      notFoundContent="暂无匹配的规则，请先创建规则"
                      options={rules.filter(r => r.fileType === fileType).map(r => ({
                        label: `${r.name}${r.aiGenerated ? ' 🤖' : ''}`,
                        value: r.id,
                      }))}
                    />
                  </div>

                  {/* 选中规则后的详情预览 */}
                  {selectedRuleId && (() => {
                    const selectedRule = rules.find(r => r.id === selectedRuleId);
                    if (!selectedRule) return null;
                    return (
                      <div style={{
                        background: '#fafafa', borderRadius: 8, padding: 16, marginBottom: 12,
                        border: '1px solid #f0f0f0'
                      }}>
                        <Descriptions size="small" column={2}>
                          <Descriptions.Item label="规则名称">{selectedRule.name}</Descriptions.Item>
                          <Descriptions.Item label="文件类型">
                            <Tag>{selectedRule.fileType}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="字段映射数">{selectedRule.columnMappings?.length || 0} 个</Descriptions.Item>
                          <Descriptions.Item label="来源">
                            {selectedRule.aiGenerated ? <Tag color="purple">AI生成</Tag> : <Tag>手动创建</Tag>}
                          </Descriptions.Item>
                          {selectedRule.description && (
                            <Descriptions.Item label="描述" span={2}>{selectedRule.description}</Descriptions.Item>
                          )}
                        </Descriptions>
                      </div>
                    );
                  })()}

                  <Space style={{ marginTop: 8 }}>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={handleParse}
                      disabled={!selectedRuleId}
                      loading={loading}
                      style={{ background: '#0fc6c2', borderColor: '#0fc6c2' }}
                    >
                      执行解析
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
                      编辑此规则
                    </Button>
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => router.push('/rules/new')}
                    >
                      创建新规则
                    </Button>
                  </Space>

                  {loading && (
                    <div style={{ marginTop: 16 }}>
                      <Progress percent={progress.percent} strokeColor="#0fc6c2" />
                      <Text type="secondary">{progress.statusText}</Text>
                    </div>
                  )}
                </div>
              )}

              {/* === 模式二：AI 智能生成规则 === */}
              {ruleSelectionMode === 'ai-generate' && (
                <div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    使用 AI 自动分析文件结构，智能生成解析规则，确认后即可使用
                  </Text>

                  {/* AI 未开始 */}
                  {aiAnalysisStatus === 'idle' && (
                    <div style={{ textAlign: 'center', padding: '32px 0' }}>
                      <RobotOutlined style={{ fontSize: 48, color: '#0fc6c2', marginBottom: 16 }} />
                      <div style={{ marginBottom: 8 }}>
                        <Text>AI 将自动识别表头、字段映射和数据区域</Text>
                      </div>
                      <Button
                        type="primary"
                        size="large"
                        icon={<BulbOutlined />}
                        onClick={handleAiGenerateRule}
                        loading={aiLoading}
                        style={{ background: '#0fc6c2', borderColor: '#0fc6c2' }}
                      >
                        AI 分析生成规则
                      </Button>
                    </div>
                  )}

                  {/* AI 分析中 */}
                  {aiAnalysisStatus === 'generating-rule' && (
                    <div style={{ textAlign: 'center', padding: '48px 0' }}>
                      <Spin size="large" />
                      <div style={{ marginTop: 20 }}>
                        <Title level={5}>
                          <RobotOutlined style={{ color: '#0fc6c2', marginRight: 8 }} />
                          AI 正在分析文件结构...
                        </Title>
                      </div>
                      <Text type="secondary">正在识别表头、字段类型和数据区域</Text>
                    </div>
                  )}

                  {/* AI 生成完成，展示规则 */}
                  {aiAnalysisStatus === 'done' && aiGeneratedRule && (
                    <div>
                      <Alert
                        type="success"
                        showIcon
                        message="AI 规则生成成功"
                        description={`置信度: ${Math.round((aiGeneratedRule.confidence || 0.7) * 100)}% — 建议人工确认后再执行解析`}
                        style={{ marginBottom: 16 }}
                      />

                      {aiGeneratedRule.warnings && aiGeneratedRule.warnings.length > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message="AI 推测标注"
                          description={aiGeneratedRule.warnings.map((w: string, i: number) => (
                            <div key={i}>- {w}</div>
                          ))}
                        />
                      )}

                      {/* 文件预览 */}
                      {filePreview && (
                        <div style={{ marginBottom: 16 }}>
                          <Text strong>文件内容预览：</Text>
                          <pre style={{
                            background: '#f5f5f5', padding: 12, borderRadius: 8,
                            maxHeight: 160, overflow: 'auto', fontSize: 12, marginTop: 8,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                          }}>
                            {filePreview}
                          </pre>
                        </div>
                      )}

                      {/* 规则详情 */}
                      <div style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Text strong>AI 生成的规则配置：</Text>
                          <Button
                            size="small"
                            type="link"
                            icon={<EditOutlined />}
                            onClick={() => {
                              const now = new Date().toISOString();
                              const tempRule: ParseRule = {
                                id: uuidv4(),
                                name: aiGeneratedRule.name || `AI-${file?.name}`,
                                fileType: aiGeneratedRule.fileType || fileType,
                                description: aiGeneratedRule.description || '',
                                sourceArea: aiGeneratedRule.sourceArea || { sheetMode: 'first', headerSkipRows: 0, headerRowIndex: 1, dataStartRow: 2 },
                                columnMappings: aiGeneratedRule.columnMappings || [],
                                tailExtractions: aiGeneratedRule.tailExtractions || [],
                                aiGenerated: true,
                                confidence: aiGeneratedRule.confidence || 0.7,
                                warnings: aiGeneratedRule.warnings || [],
                                createdAt: now,
                                updatedAt: now,
                              };
                              setRuleToEdit(tempRule);
                              setShowRuleEditor(true);
                            }}
                          >
                            在编辑器中查看/修改
                          </Button>
                        </div>
                        <pre style={{
                          background: '#f5f5f5', padding: 12, borderRadius: 8,
                          maxHeight: 240, overflow: 'auto', fontSize: 12,
                          border: '1px solid #e8e8e8'
                        }}>
                          {JSON.stringify(aiGeneratedRule, null, 2)}
                        </pre>
                      </div>

                      <Divider />

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Button
                          type="primary"
                          size="large"
                          icon={<PlayCircleOutlined />}
                          onClick={handleParseWithAiRule}
                          loading={loading}
                          style={{ background: '#0fc6c2', borderColor: '#0fc6c2' }}
                        >
                          使用此规则解析文件
                        </Button>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={handleAiGenerateRule}
                          disabled={aiLoading}
                        >
                          重新生成
                        </Button>
                      </div>

                      {loading && (
                        <div style={{ marginTop: 16 }}>
                          <Progress percent={progress.percent} strokeColor="#0fc6c2" />
                          <Text type="secondary">{progress.statusText}</Text>
                        </div>
                      )}
                    </div>
                  )}

                  {/* AI 生成失败 */}
                  {aiAnalysisStatus === 'error' && (
                    <div>
                      <Alert
                        type="warning"
                        showIcon
                        icon={<ExclamationCircleOutlined />}
                        message="AI 规则生成失败"
                        description={parseError || 'AI 无法识别此文件格式，请尝试手动选择已有规则'}
                        style={{ marginBottom: 16 }}
                        action={
                          <Button size="small" onClick={handleAiGenerateRule} icon={<ReloadOutlined />}>
                            重试
                          </Button>
                        }
                      />
                      <Button onClick={() => setRuleSelectionMode('existing')}>
                        切换到已有规则
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </>
        )}

        {/* Step 3: Preview & Edit */}
        {step === 3 && (
          <>
            <Card style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space size={32}>
                  <Statistic
                    title="总记录数"
                    value={editingData.length}
                    suffix="条"
                    valueStyle={{ color: '#1d2129', fontSize: 24 }}
                  />
                  <Statistic
                    title="有效数据"
                    value={validCount}
                    suffix="条"
                    valueStyle={{ color: '#52c41a', fontSize: 24 }}
                  />
                  <Statistic
                    title="涉及门店"
                    value={uniqueStores}
                    suffix="家"
                    valueStyle={{ color: '#0fc6c2', fontSize: 24 }}
                  />
                  {errorCount > 0 && (
                    <Statistic
                      title="数据错误"
                      value={errorCount}
                      suffix="处"
                      valueStyle={{ color: '#ff4d4f', fontSize: 24 }}
                    />
                  )}
                </Space>
                <Space>
                  <Tag icon={<RobotOutlined />} color={parseMode === 'ai-direct' ? 'purple' : 'cyan'}>
                    {parseMode === 'ai-direct' ? 'AI直接解析' : parseMode === 'rule' ? '规则解析' : '自动'}
                  </Tag>
                  <Tag color="blue">{file?.name}</Tag>
                </Space>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <Title level={5} style={{ margin: 0 }}>
                    <SafetyCertificateOutlined style={{ color: '#0fc6c2', marginRight: 8 }} />
                    数据预览与编辑
                  </Title>
                  <Text type="secondary">确认数据无误后，点击"批量提交运单"生成运单</Text>
                </div>
                <Space>
                  <Button icon={<DownloadOutlined />} onClick={handleExport}>导出 Excel</Button>
                  <Button icon={<ArrowLeftOutlined />} onClick={() => {
                    setStep(2);
                    setAiAnalysisStatus('idle');
                    setAiGeneratedRule(null);
                    setFilePreview('');
                    setParseError('');
                    setSelectedRuleId('');
                    setRuleSelectionMode('existing');
                  }}>
                    重新解析
                  </Button>
                  <Button
                    type="primary"
                    onClick={handleSubmit}
                    loading={submitLoading}
                    disabled={editingData.length === 0}
                    style={{ background: hasErrors ? undefined : '#0fc6c2', borderColor: hasErrors ? undefined : '#0fc6c2' }}
                  >
                    <ThunderboltOutlined /> 批量提交运单
                  </Button>
                </Space>
              </div>

              {validationErrors.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message={`发现 ${validationErrors.length} 个数据错误，请修正后提交`}
                  style={{ marginBottom: 12 }}
                />
              )}

              {duplicateWarnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message="外部编码重复检测"
                  description={duplicateWarnings.slice(0, 5).map((w, i) => <div key={i}>{w}</div>)}
                  style={{ marginBottom: 12 }}
                />
              )}

              {submitLoading && (
                <div style={{ marginBottom: 16 }}>
                  <Progress
                    percent={Math.round((progress.current / Math.max(progress.total, 1)) * 100)}
                    strokeColor={{ '0%': '#0fc6c2', '100%': '#0bada9' }}
                  />
                  <Text type="secondary">{progress.statusText} {progress.current}/{progress.total}</Text>
                </div>
              )}

              <DataTable
                data={editingData}
                onChange={handleDataChange}
                validationErrors={validationErrors}
                duplicateWarnings={duplicateWarnings}
              />
            </Card>
          </>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <Card>
            <Result
              status={submitResult?.successCount > 0 ? 'success' : 'error'}
              icon={submitResult?.successCount > 0 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              title={submitResult?.successCount > 0 ? '批量导入成功' : '导入失败'}
              subTitle={
                submitResult?.successCount > 0
                  ? `已成功生成 ${submitResult.successCount} 条运单`
                  : '请检查数据后重试'
              }
              extra={[
                <div key="details" style={{ marginBottom: 24 }}>
                  <Descriptions bordered size="small" column={2} style={{ maxWidth: 600, margin: '0 auto' }}>
                    <Descriptions.Item label="批次号">{submitResult?.batchId}</Descriptions.Item>
                    <Descriptions.Item label="总记录数">{submitResult?.totalCount}</Descriptions.Item>
                    <Descriptions.Item label="成功">
                      <Text type="success">{submitResult?.successCount} 条</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="失败">
                      <Text type="danger">{submitResult?.failCount} 条</Text>
                    </Descriptions.Item>
                  </Descriptions>
                  {submitResult?.errors?.length > 0 && (
                    <div style={{ marginTop: 12, textAlign: 'left', maxWidth: 600, margin: '12px auto 0' }}>
                      <Text type="danger">失败详情：</Text>
                      {submitResult.errors.slice(0, 5).map((err: string, i: number) => (
                        <div key={i}><Text type="danger" style={{ fontSize: 12 }}>{err}</Text></div>
                      ))}
                      {submitResult.errors.length > 5 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>...还有 {submitResult.errors.length - 5} 条错误</Text>
                      )}
                    </div>
                  )}
                </div>,
                <Space key="actions">
                  <Button onClick={handleBackToFile} icon={<InboxOutlined />}>继续导入</Button>
                  <Button onClick={() => router.push('/orders')} type="primary" style={{ background: '#0fc6c2', borderColor: '#0fc6c2' }}>
                    查看运单列表
                  </Button>
                </Space>,
              ]}
            />
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

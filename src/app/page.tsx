'use client';

import { useState, useRef } from 'react';
import {
  Upload, Button, Select, Card, message, Typography, Spin, Space,
  Modal, Input, Steps, Progress, Table, Alert, Tag, Tooltip, App,
  Result, Descriptions, Badge, Statistic, Divider, Empty
} from 'antd';
import {
  UploadOutlined, InboxOutlined, PlusOutlined, DownloadOutlined,
  DeleteOutlined, EditOutlined, EyeOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ArrowLeftOutlined, RobotOutlined,
  ThunderboltOutlined, FileTextOutlined, SafetyCertificateOutlined,
  ReloadOutlined, ExclamationCircleOutlined
} from '@ant-design/icons';
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

type ParseMode = 'auto' | 'rule' | 'ai-direct';

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<string>('');
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
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
  const [autoParseStarted, setAutoParseStarted] = useState(false);

  // AI 自动分析状态
  const [aiAnalysisStatus, setAiAnalysisStatus] = useState<'idle' | 'analyzing' | 'generating-rule' | 'parsing' | 'done' | 'error'>('idle');

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
        // AI 规则生成失败，尝试直接解析
        setProgress({ current: 1, total: 3, percent: 33, statusText: 'AI 规则生成失败，尝试直接解析...' });
        await startDirectParse(uploadFile);
        return;
      }

      const aiRule = ruleData.rule;
      setFilePreview(ruleData.filePreview || '');
      setAiGeneratedRule(aiRule);

      // 保存 AI 生成的规则
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

      // 第2步：使用 AI 规则执行解析
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
        // 规则解析成功
        setParsedData(parseData.data);
        setEditingData(parseData.data);
        setParseMode('rule');
        setSelectedRuleId(savedRule.id);
        finishAnalysis(parseData.data);
      } else {
        // 规则解析失败或无数据，尝试 AI 直接解析
        setProgress({ current: 2, total: 3, percent: 66, statusText: '规则解析未获得有效数据，尝试AI直接解析...' });
        await startDirectParse(uploadFile);
        return;
      }
    } catch (e: any) {
      // AI 规则方式失败，尝试直接解析
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
      // 两种方式都失败，让用户手动选择规则
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
    const dt = detectFileType(file.name);
    setFileType(dt || '');
    setStep(2);
    setSelectedRuleId('');
    setParsedData([]);
    setParseError('');
    setAutoParseStarted(true);
    setAiAnalysisStatus('analyzing');
    setParseMode('auto');

    // 自动触发 AI 分析
    startAutoAnalysis(file);
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
    message.success('规则已更新');
  };

  const handleBackToFile = () => {
    setStep(1);
    setFile(null);
    setParsedData([]);
    setEditingData([]);
    setSubmitResult(null);
    setValidationErrors([]);
    setAiAnalysisStatus('idle');
    setAutoParseStarted(false);
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
    { title: 'AI 分析' },
    { title: '预览编辑' },
    { title: '完成' },
  ];

  const hasErrors = validationErrors.length > 0 || duplicateWarnings.length > 0;

  // 统计信息
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
                accept=".xlsx,.xls,.docx,.pdf"
                beforeUpload={(file) => { handleFileSelect(file); return false; }}
                showUploadList={false}
                style={{ padding: 32 }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined style={{ fontSize: 48, color: '#0fc6c2' }} />
                </p>
                <p className="ant-upload-text" style={{ fontSize: 16 }}>点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 Excel (.xlsx/.xls)、Word (.docx)、PDF 格式
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

        {/* Step 2: AI Analysis */}
        {step === 2 && (
          <Card>
            {/* AI 自动分析进度 */}
            {(aiAnalysisStatus === 'analyzing' || aiAnalysisStatus === 'generating-rule' || aiAnalysisStatus === 'parsing') && (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <Spin size="large" />
                <div style={{ marginTop: 20 }}>
                  <Title level={5}>
                    <RobotOutlined style={{ color: '#0fc6c2', marginRight: 8 }} />
                    AI 正在智能分析
                  </Title>
                </div>
                <div style={{ maxWidth: 400, margin: '16px auto' }}>
                  <Progress
                    percent={progress.percent}
                    strokeColor={{ '0%': '#0fc6c2', '100%': '#0bada9' }}
                    status="active"
                  />
                </div>
                <Text type="secondary">{progress.statusText}</Text>
                <div style={{ marginTop: 16 }}>
                  <Space direction="vertical" size={4}>
                    <Text type={aiAnalysisStatus === 'analyzing' || aiAnalysisStatus === 'generating-rule' ? 'success' : 'secondary'}>
                      {aiAnalysisStatus === 'analyzing' ? '✅' : '⏳'} 读取文件内容
                    </Text>
                    <Text type={aiAnalysisStatus === 'generating-rule' ? 'success' : 'secondary'}>
                      {aiAnalysisStatus === 'generating-rule' ? '✅' : aiAnalysisStatus === 'parsing' ? '⏳' : '○'} AI 分析文件格式
                    </Text>
                    <Text type={aiAnalysisStatus === 'parsing' ? 'success' : 'secondary'}>
                      {aiAnalysisStatus === 'parsing' ? '⏳' : '○'} 提取结构化数据
                    </Text>
                  </Space>
                </div>
              </div>
            )}

            {/* AI 分析失败，手动模式 */}
            {aiAnalysisStatus === 'error' && (
              <div>
                <Alert
                  type="warning"
                  showIcon
                  icon={<ExclamationCircleOutlined />}
                  message="AI 自动分析未能完成"
                  description={parseError || 'AI 无法自动识别文件格式，您可以手动选择已有规则或创建新规则'}
                  style={{ marginBottom: 16 }}
                  action={
                    <Button size="small" onClick={handleRetryAutoAnalysis} icon={<ReloadOutlined />}>
                      重试AI分析
                    </Button>
                  }
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <FileTextOutlined />
                  <Text strong>{file?.name}</Text>
                  <Tag color="blue">{fileType}</Tag>
                </div>

                <Title level={5}>手动选择解析规则</Title>
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
                <div style={{ marginTop: 24, display: 'flex', gap: 8 }}>
                  <Button onClick={() => setStep(1)} icon={<ArrowLeftOutlined />}>返回</Button>
                  <Button type="primary" onClick={handleParse} disabled={!selectedRuleId} loading={loading}>
                    执行解析
                  </Button>
                </div>
                {loading && (
                  <div style={{ marginTop: 16 }}>
                    <Progress percent={progress.percent} />
                    <Text type="secondary">{progress.statusText}</Text>
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Step 3: Preview & Edit */}
        {step === 3 && (
          <>
            {/* 数据统计卡片 */}
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
                  <Button icon={<ArrowLeftOutlined />} onClick={() => { setStep(2); setAiAnalysisStatus('error'); }}>
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
                  <Button onClick={handleBackToFile} icon={<UploadOutlined />}>继续导入</Button>
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

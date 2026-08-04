'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Upload, Button, Card, Typography, Space, Steps, message, Spin,
  Table, Tag, Divider, Alert, Tabs, Descriptions, Result, Modal, Input,
} from 'antd';
import {
  InboxOutlined, ThunderboltOutlined, SettingOutlined,
  FileExcelOutlined, RobotOutlined, CheckCircleOutlined,
  EyeOutlined, ArrowRightOutlined, RocketOutlined,
} from '@ant-design/icons';

const { Dragger } = Upload;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('ai-parse');

  // ========== AI 直接解析状态 ==========
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[]; summary: string } | null>(null);
  const [aiImporting, setAiImporting] = useState(false);
  const [aiResult, setAiResult] = useState<{ taskId: string; traceId: string } | null>(null);

  // ========== 规则引擎导入状态 ==========
  const [ruleFile, setRuleFile] = useState<File | null>(null);

  // ========== AI 生成规则状态 ==========
  const [genFile, setGenFile] = useState<File | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genRule, setGenRule] = useState<string>('');
  const [genRuleName, setGenRuleName] = useState('');
  const [genExport, setGenExport] = useState<string>('');
  const [genPreviewCols, setGenPreviewCols] = useState<string[]>([]);

  // ============ AI 直接解析流程 ============
  const handleAiParse = async () => {
    if (!aiFile) { message.warning('请先上传文件'); return; }
    setAiParsing(true);
    setAiPreview(null);

    try {
      const formData = new FormData();
      formData.append('file', aiFile);

      const res = await fetch('/api/ai/direct-parse', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.error) {
        message.error(data.error);
        return;
      }

      // 转换字段：API 返回 {columns, rows, summary} 或 {fields, data, ...}
      const columns = data.columns || data.fields || Object.keys(data.data?.[0] || {});
      const rows = data.rows || data.data || [];
      const summary = data.summary || data.aiSummary || `共解析 ${rows.length} 行, ${columns.length} 个字段`;

      setAiPreview({ columns, rows, summary });
      message.success(`AI 解析完成，共 ${rows.length} 行`);
    } catch (e) {
      message.error(`解析失败: ${String(e)}`);
    } finally {
      setAiParsing(false);
    }
  };

  const handleAiImport = async () => {
    if (!aiPreview) return;
    setAiImporting(true);

    try {
      const res = await fetch('/api/import-tasks/ai-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: aiPreview.rows,
          fileName: aiFile?.name || 'AI-解析数据',
          fileType: aiFile?.type || 'application/json',
        }),
      });
      const result = await res.json();

      if (result.error) {
        message.error(result.error);
        return;
      }

      // 触发 Outbox 调度
      try { await fetch('/api/import-tasks/dispatch', { method: 'POST' }); } catch {}

      setAiResult({ taskId: result.taskId, traceId: result.traceId });
      message.success('导入任务已创建，数据正在异步处理中');
    } catch (e) {
      message.error(`导入失败: ${String(e)}`);
    } finally {
      setAiImporting(false);
    }
  };

  // ============ 规则引擎导入流程 ============
  const handleRuleImport = () => {
    if (!ruleFile) { message.warning('请先上传文件'); return; }
    // 跳转到 rules 选择页面（附带文件信息）
    sessionStorage.setItem('importFile_name', ruleFile.name);
    sessionStorage.setItem('importFile_size', String(ruleFile.size));
    sessionStorage.setItem('importFile_lastModified', String(ruleFile.lastModified));
    router.push('/rules?mode=import-select');
  };

  // ============ AI 生成规则流程 ============
  const handleGenerateRule = async () => {
    if (!genFile) { message.warning('请先上传文件'); return; }
    setGenLoading(true);
    setGenRule('');

    try {
      const formData = new FormData();
      formData.append('file', genFile);

      const res = await fetch('/api/ai/generate-rule', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.error) {
        message.error(data.error);
        return;
      }

      setGenRule(data.rule || JSON.stringify(data.parsedRule || {}, null, 2));
      setGenRuleName(data.ruleName || data.name || '');
      setGenExport(data.exportConfig || data.export || JSON.stringify(data.targetSchema || {}, null, 2));
      setGenPreviewCols(data.columns || data.previewCols || []);
      message.success('AI 生成规则完成，请确认并保存');
    } catch (e) {
      message.error(`规则生成失败: ${String(e)}`);
    } finally {
      setGenLoading(false);
    }
  };

  const handleSaveRule = async () => {
    if (!genRule) return;
    try {
      let ruleObj: any;
      try { ruleObj = JSON.parse(genRule); } catch { ruleObj = { raw: genRule }; }

      const exportObj = (() => { try { return JSON.parse(genExport); } catch { return null; } })();

      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: genRuleName || genFile?.name || 'AI 生成规则',
          description: `由 AI 基于 "${genFile?.name}" 自动生成`,
          type: 'import',
          sourceColumns: genPreviewCols,
          parseRule: { ...ruleObj, export: exportObj },
          aiGenerated: true,
        }),
      });
      const data = await res.json();

      if (data.error || data.code === 500) {
        message.error(data.error || data.message || '保存失败');
        return;
      }

      message.success('规则已保存');
      router.push('/rules');
    } catch (e) {
      message.error(`保存失败: ${String(e)}`);
    }
  };

  const handleSaveAndUse = async () => {
    if (!genRule) return;
    try {
      let ruleObj: any;
      try { ruleObj = JSON.parse(genRule); } catch { ruleObj = { raw: genRule }; }
      const exportObj = (() => { try { return JSON.parse(genExport); } catch { return null; } })();

      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: genRuleName || genFile?.name || 'AI 生成规则',
          description: `由 AI 基于 "${genFile?.name}" 自动生成`,
          type: 'import',
          sourceColumns: genPreviewCols,
          parseRule: { ...ruleObj, export: exportObj },
          aiGenerated: true,
        }),
      });
      const data = await res.json();

      if (data.error || data.code === 500) {
        message.error(data.error || data.message || '保存失败');
        return;
      }

      message.success('规则已保存，跳转到任务创建');
      // 保存文件消息到 session 供 rule-import 使用
      if (genFile) {
        sessionStorage.setItem('importFile_name', genFile.name);
        sessionStorage.setItem('importFile_size', String(genFile.size));
        sessionStorage.setItem('preselected_rule', data.id || data.ruleId);
      }
      router.push('/rules?mode=import-select');
    } catch (e) {
      message.error(`操作失败: ${String(e)}`);
    }
  };

  // ============ AI 预览表格列 ============
  const previewTableCols = aiPreview?.columns.slice(0, 8).map((col) => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    width: 140,
    render: (v: unknown) => {
      const s = String(v ?? '');
      return s.length > 30 ? s.slice(0, 30) + '...' : s;
    },
  })) || [];
  if (aiPreview && aiPreview.columns.length > 8) {
    previewTableCols.push({
      title: `+${aiPreview.columns.length - 8} 列`,
      key: 'more',
      width: 80,
      render: () => <Tag>...</Tag>,
    });
  }

  // ============ 渲染 ============
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2}>
          <RocketOutlined style={{ marginRight: 8, color: '#1677ff' }} />
          智能导入工作台
        </Title>
        <Text type="secondary">
          支持 AI 智能解析、规则引擎导入、自动规则生成三种模式
        </Text>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        centered
        size="large"
        items={[
          {
            key: 'ai-parse',
            label: <span><ThunderboltOutlined /> AI 智能解析</span>,
            children: (
              <Card>
                <Steps
                  current={aiResult ? 3 : aiPreview ? 2 : aiFile ? 1 : 0}
                  size="small"
                  style={{ marginBottom: 24 }}
                  items={[
                    { title: '上传文件', icon: <FileExcelOutlined /> },
                    { title: 'AI 解析预览', icon: <RobotOutlined /> },
                    { title: '确认导入', icon: <CheckCircleOutlined /> },
                    { title: '完成', icon: <RocketOutlined /> },
                  ]}
                />

                {!aiResult ? (
                  <>
                    {/* Step 1: 上传 */}
                    <div style={{ marginBottom: 16 }}>
                      <Dragger
                        accept=".xlsx,.xls,.csv,.tsv,.txt"
                        maxCount={1}
                        beforeUpload={(f) => { setAiFile(f); setAiPreview(null); return false; }}
                        fileList={aiFile ? [{ uid: '-1', name: aiFile.name, status: 'done' }] : []}
                        onRemove={() => { setAiFile(null); setAiPreview(null); }}
                      >
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">点击或拖拽文件到此处</p>
                        <p className="ant-upload-hint">支持 .xlsx .csv .tsv 格式</p>
                      </Dragger>
                    </div>

                    <Space>
                      <Button
                        type="primary"
                        icon={<RobotOutlined />}
                        loading={aiParsing}
                        disabled={!aiFile}
                        onClick={handleAiParse}
                        size="large"
                      >
                        AI 解析文件
                      </Button>
                      {aiFile && (
                        <Text type="secondary">已选择: {aiFile.name} ({(aiFile.size / 1024).toFixed(1)} KB)</Text>
                      )}
                    </Space>

                    {/* Step 2: AI 预览 */}
                    {aiPreview && (
                      <>
                        <Divider />
                        <Alert
                          type="info"
                          message={`AI 解析结果: ${aiPreview.summary}`}
                          style={{ marginBottom: 12 }}
                        />
                        <Table
                          dataSource={aiPreview.rows.slice(0, 10).map((r, i) => ({ ...r, _key: i }))}
                          columns={previewTableCols}
                          rowKey="_key"
                          size="small"
                          scroll={{ x: 600 }}
                          pagination={false}
                          style={{ marginBottom: 12 }}
                        />
                        {aiPreview.rows.length > 10 && (
                          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                            仅预览前 10 行，共 {aiPreview.rows.length} 行
                          </Text>
                        )}

                        <Button
                          type="primary"
                          icon={<RocketOutlined />}
                          loading={aiImporting}
                          onClick={handleAiImport}
                          size="large"
                        >
                          确认并开始导入
                        </Button>
                      </>
                    )}
                  </>
                ) : (
                  /* Step 3: 完成 */
                  <Result
                    status="success"
                    title="导入任务已创建"
                    subTitle={`共 ${aiPreview?.rows.length || '?'} 行数据，系统正在异步处理中`}
                    extra={[
                      <Button
                        key="view"
                        type="primary"
                        onClick={() => router.push(`/import-tasks/${aiResult.taskId}`)}
                      >
                        查看任务进度
                      </Button>,
                      <Button
                        key="trace"
                        onClick={() => router.push(`/traces/${aiResult.traceId}`)}
                      >
                        查看链路追踪
                      </Button>,
                      <Button
                        key="reset"
                        onClick={() => {
                          setAiFile(null); setAiPreview(null); setAiResult(null);
                        }}
                      >
                        继续导入
                      </Button>,
                    ]}
                  >
                    <Descriptions size="small" column={2} style={{ textAlign: 'left', maxWidth: 400, margin: '16px auto' }}>
                      <Descriptions.Item label="任务ID">{aiResult.taskId}</Descriptions.Item>
                      <Descriptions.Item label="Trace ID">{aiResult.traceId}</Descriptions.Item>
                    </Descriptions>
                  </Result>
                )}
              </Card>
            ),
          },
          {
            key: 'rule-engine',
            label: <span><SettingOutlined /> 规则引擎导入</span>,
            children: (
              <Card>
                <Steps
                  current={ruleFile ? 1 : 0}
                  size="small"
                  style={{ marginBottom: 24 }}
                  items={[
                    { title: '上传文件', icon: <FileExcelOutlined /> },
                    { title: '选择规则', icon: <SettingOutlined /> },
                    { title: '确认导入', icon: <RocketOutlined /> },
                  ]}
                />

                <div style={{ marginBottom: 16 }}>
                  <Dragger
                    accept=".xlsx,.xls,.csv,.tsv,.txt,.docx"
                    maxCount={1}
                    beforeUpload={(f) => { setRuleFile(f); return false; }}
                    fileList={ruleFile ? [{ uid: '-1', name: ruleFile.name, status: 'done' }] : []}
                    onRemove={() => setRuleFile(null)}
                  >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">点击或拖拽文件到此处</p>
                    <p className="ant-upload-hint">支持 .xlsx .csv .tsv 格式</p>
                  </Dragger>
                </div>

                <Button
                  type="primary"
                  icon={<ArrowRightOutlined />}
                  disabled={!ruleFile}
                  onClick={handleRuleImport}
                  size="large"
                >
                  选择导入规则
                </Button>
                {ruleFile && (
                  <Text type="secondary" style={{ marginLeft: 12 }}>
                    {ruleFile.name} ({(ruleFile.size / 1024).toFixed(1)} KB)
                  </Text>
                )}
              </Card>
            ),
          },
          {
            key: 'ai-gen-rule',
            label: <span><RobotOutlined /> AI 生成规则</span>,
            children: (
              <Card>
                <Steps
                  current={genRule ? (genFile ? 3 : 2) : genFile ? 1 : 0}
                  size="small"
                  style={{ marginBottom: 24 }}
                  items={[
                    { title: '上传样例文件', icon: <FileExcelOutlined /> },
                    { title: 'AI 分析结构', icon: <RobotOutlined /> },
                    { title: '确认规则', icon: <EyeOutlined /> },
                    { title: '保存并使用', icon: <CheckCircleOutlined /> },
                  ]}
                />

                <div style={{ marginBottom: 16 }}>
                  <Dragger
                    accept=".xlsx,.xls,.csv,.tsv"
                    maxCount={1}
                    beforeUpload={(f) => { setGenFile(f); setGenRule(''); return false; }}
                    fileList={genFile ? [{ uid: '-1', name: genFile.name, status: 'done' }] : []}
                    onRemove={() => { setGenFile(null); setGenRule(''); }}
                  >
                    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                    <p className="ant-upload-text">上传样例文件</p>
                    <p className="ant-upload-hint">AI 将基于样例数据自动分析字段结构并生成导入规则</p>
                  </Dragger>
                </div>

                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={genLoading}
                  disabled={!genFile}
                  onClick={handleGenerateRule}
                  size="large"
                >
                  AI 生成导入规则
                </Button>

                {genRule && (
                  <>
                    <Divider />
                    <Alert
                      type="success"
                      message="规则已生成"
                      description="AI 已根据文件结构自动生成了匹配规则和字段映射。请确认后保存。"
                      style={{ marginBottom: 16 }}
                    />

                    {genPreviewCols.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <Text strong>识别到的字段: </Text>
                        <Space wrap>
                          {genPreviewCols.map((c) => <Tag key={c} color="blue">{c}</Tag>)}
                        </Space>
                      </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                      <Text strong>规则名称: </Text>
                      <input
                        value={genRuleName}
                        onChange={(e) => setGenRuleName(e.target.value)}
                        placeholder="输入规则名称"
                        style={{
                          border: '1px solid #d9d9d9', borderRadius: 4,
                          padding: '4px 8px', width: 280, marginLeft: 8,
                        }}
                      />
                    </div>

                    <Text strong>生成的匹配规则 (Mappings):</Text>
                    <TextArea
                      value={genRule}
                      onChange={(e) => setGenRule(e.target.value)}
                      rows={10}
                      style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8, marginBottom: 8 }}
                    />

                    <Text strong>目标字段映射 (Export Schema):</Text>
                    <TextArea
                      value={genExport}
                      onChange={(e) => setGenExport(e.target.value)}
                      rows={6}
                      style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8, marginBottom: 16 }}
                    />

                    <Space>
                      <Button
                        type="primary"
                        icon={<CheckCircleOutlined />}
                        onClick={handleSaveRule}
                      >
                        保存规则
                      </Button>
                      <Button
                        icon={<RocketOutlined />}
                        onClick={handleSaveAndUse}
                      >
                        保存并使用
                      </Button>
                      <Button onClick={() => setGenRule('')}>重新生成</Button>
                    </Space>
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />

      {/* 底部说明 */}
      <Card size="small" style={{ marginTop: 24, background: '#fafafa' }}>
        <Space direction="vertical" size={4}>
          <Text strong>三种模式对比:</Text>
          <Text type="secondary">
            <Tag color="blue">AI 智能解析</Tag> AI 自动识别文件结构、清洗数据、直接导入 — 适合格式统一的标准文件
          </Text>
          <Text type="secondary">
            <Tag color="green">规则引擎导入</Tag> 使用预设规则映射字段、校验数据 — 适合需要精确控制的复杂场景
          </Text>
          <Text type="secondary">
            <Tag color="purple">AI 生成规则</Tag> AI 根据样例文件自动生成匹配规则 — 适合快速建立新规则，后续可手动调整
          </Text>
        </Space>
      </Card>
    </div>
  );
}

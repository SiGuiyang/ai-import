'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Card, Table, Button, Space, Tag, Typography, message, Popconfirm,
  Upload, Modal, Input, Spin,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined,
  RobotOutlined, InboxOutlined, CopyOutlined, RocketOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;
const { TextArea } = Input;

function RulesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectMode = searchParams.get('mode') === 'import-select';

  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // AI 生成规则弹窗
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genFile, setGenFile] = useState<File | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genRule, setGenRule] = useState('');
  const [genRuleName, setGenRuleName] = useState('');
  const [genExport, setGenExport] = useState('');
  const [genPreviewCols, setGenPreviewCols] = useState<string[]>([]);

  // 导入弹窗
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRule, setImportRule] = useState<any>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      setRules(Array.isArray(data) ? data : data.data || []);
    } catch {
      message.error('获取规则列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      message.success('已删除');
      fetchRules();
    } catch { message.error('删除失败'); }
  };

  const handleSelectAndImport = async (rule: any) => {
    // 打开导入弹窗（需上传文件 + 选中规则）
    setImportRule(rule);
    setImportModalOpen(true);
  };

  // ========== AI 生成规则 ==========
  const handleGenerateRule = async () => {
    if (!genFile) { message.warning('请上传文件'); return; }
    setGenLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', genFile);

      const res = await fetch('/api/ai/generate-rule', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.error) { message.error(data.error); return; }

      setGenRule(JSON.stringify(data.rule || data.parsedRule || {}, null, 2));
      setGenRuleName(data.ruleName || data.name || '');
      setGenExport(JSON.stringify(data.exportConfig || data.export || data.targetSchema || {}, null, 2));
      setGenPreviewCols(data.columns || data.previewCols || []);
      message.success('规则生成完成');
    } catch (e) {
      message.error(`生成失败: ${String(e)}`);
    } finally {
      setGenLoading(false);
    }
  };

  // ========== 选择规则导入 ==========
  const handleDoImport = async () => {
    if (!importFile || !importRule) {
      message.warning('请先选择文件和规则');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('ruleId', importRule.id);

      const res = await fetch('/api/import-tasks', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.error) {
        message.error(data.error);
        return;
      }

      message.success('导入任务已创建');
      setImportModalOpen(false);

      // 跳转到任务详情
      if (data.taskId) {
        router.push(`/import-tasks/${data.taskId}`);
      }
    } catch (e) {
      message.error(`导入失败: ${String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleSaveGeneratedRule = async () => {
    let ruleObj: any;
    try { ruleObj = JSON.parse(genRule); } catch { ruleObj = { raw: genRule }; }

    let exportObj = null;
    try { exportObj = JSON.parse(genExport); } catch {}

    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: genRuleName || 'AI 生成规则',
          description: `AI 基于 "${genFile?.name}" 自动生成`,
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
      setGenModalOpen(false);
      setGenFile(null);
      setGenRule('');
      fetchRules();
    } catch (e) {
      message.error(`保存失败: ${String(e)}`);
    }
  };

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: any) => (
        <Space>
          <Text strong>{text}</Text>
          {record.aiGenerated && <Tag color="purple" icon={<RobotOutlined />}>AI 生成</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (v: string) => <Tag>{v || 'import'}</Tag>,
    },
    {
      title: '源字段',
      dataIndex: 'sourceColumns',
      key: 'sourceColumns',
      render: (cols: string[]) => (
        <Space wrap size={[0, 2]}>
          {(cols || []).slice(0, 5).map((c) => <Tag key={c} style={{ fontSize: 11 }}>{c}</Tag>)}
          {(cols || []).length > 5 && <Text type="secondary" style={{ fontSize: 11 }}>+{cols.length - 5}</Text>}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (v: string) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: any) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => router.push(`/rules/${record.id}`)}
          >
            编辑
          </Button>
          {selectMode && (
            <Button
              type="primary"
              size="small"
              icon={<RocketOutlined />}
              onClick={() => handleSelectAndImport(record)}
            >
              选择并导入
            </Button>
          )}
          <Popconfirm
            title="确认删除该规则？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认" cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <SettingOutlined style={{ marginRight: 8 }} />
            {selectMode ? '选择导入规则' : '规则管理'}
          </Title>
          {selectMode && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              请选择一个规则来执行导入，或使用 AI 生成新规则
            </Text>
          )}
        </div>
        <Space>
          <Button
            icon={<RobotOutlined />}
            onClick={() => setGenModalOpen(true)}
          >
            AI 生成规则
          </Button>
          {!selectMode && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => router.push('/rules/new')}
            >
              手动创建
            </Button>
          )}
        </Space>
      </div>

      <Table
        dataSource={rules}
        columns={columns}
        rowKey="id"
        loading={loading}
        size="middle"
        pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 条` }}
      />

      {/* AI 生成规则弹窗 */}
      <Modal
        title={<span><RobotOutlined style={{ marginRight: 8 }} />AI 生成导入规则</span>}
        open={genModalOpen}
        onCancel={() => { setGenModalOpen(false); setGenRule(''); setGenFile(null); }}
        width={700}
        footer={genRule ? [
          <Button key="cancel" onClick={() => { setGenModalOpen(false); setGenRule(''); setGenFile(null); }}>
            取消
          </Button>,
          <Button key="save" type="primary" icon={<RocketOutlined />} onClick={handleSaveGeneratedRule}>
            保存规则
          </Button>,
        ] : null}
      >
        <div style={{ marginBottom: 16 }}>
          <Upload.Dragger
            accept=".xlsx,.xls,.csv,.tsv"
            maxCount={1}
            beforeUpload={(f) => { setGenFile(f); setGenRule(''); return false; }}
            fileList={genFile ? [{ uid: '-1', name: genFile.name, status: 'done' }] : []}
            onRemove={() => { setGenFile(null); setGenRule(''); }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">上传样例文件</p>
            <p className="ant-upload-hint">AI 将分析文件结构并自动生成字段映射规则</p>
          </Upload.Dragger>
        </div>

        <Button
          type="primary"
          icon={<RobotOutlined />}
          loading={genLoading}
          disabled={!genFile}
          block
          onClick={handleGenerateRule}
        >
          开始分析生成
        </Button>

        {genLoading && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin tip="AI 正在分析文件结构..." />
          </div>
        )}

        {genRule && (
          <>
            <div style={{ marginTop: 16 }}>
              <Text strong>规则名称:</Text>
              <Input
                value={genRuleName}
                onChange={(e) => setGenRuleName(e.target.value)}
                style={{ marginTop: 4 }}
              />
            </div>

            {genPreviewCols.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text strong>识别到的字段: </Text>
                <Space wrap style={{ marginTop: 4 }}>
                  {genPreviewCols.map((c) => <Tag key={c} color="blue">{c}</Tag>)}
                </Space>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <Text strong>匹配规则 (Mappings):</Text>
              <TextArea
                value={genRule}
                onChange={(e) => setGenRule(e.target.value)}
                rows={12}
                style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8 }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <Text strong>目标字段 (Export Schema):</Text>
              <TextArea
                value={genExport}
                onChange={(e) => setGenExport(e.target.value)}
                rows={6}
                style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 8 }}
              />
            </div>
          </>
        )}
      </Modal>

      {/* 选择规则导入弹窗 */}
      <Modal
        title={<span><RocketOutlined style={{ marginRight: 8 }} />确认导入</span>}
        open={importModalOpen}
        onCancel={() => { setImportModalOpen(false); setImportFile(null); }}
        onOk={handleDoImport}
        confirmLoading={importing}
        okText="开始导入"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong>已选规则: </Text>
          <Tag color="blue">{importRule?.name}</Tag>
          {importRule?.aiGenerated && <Tag color="purple">AI 生成</Tag>}
        </div>
        <div style={{ marginBottom: 8 }}>
          <Text strong>上传导入文件:</Text>
        </div>
        <Upload.Dragger
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          maxCount={1}
          beforeUpload={(f) => { setImportFile(f); return false; }}
          fileList={importFile ? [{ uid: '-1', name: importFile.name, status: 'done' }] : []}
          onRemove={() => setImportFile(null)}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽文件到此处</p>
          <p className="ant-upload-hint">文件将使用 "{importRule?.name}" 规则进行解析</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
}

export default function RulesPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}>加载中...</div>}>
      <RulesPageInner />
    </Suspense>
  );
}

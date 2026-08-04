"use client";

import React, { useState } from "react";
import {
  Card,
  Upload,
  Button,
  Input,
  Steps,
  Space,
  Typography,
  message,
  Tag,
  Descriptions,
  Collapse,
  Select,
  Alert,
} from "antd";
import {
  InboxOutlined,
  RobotOutlined,
  EditOutlined,
  SaveOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { UploadProps } from "antd";

const { Dragger } = Upload;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;
const { Option } = Select;

interface AiAnalysis {
  analysis: string;
  steps: any[];
  fieldMapping: any;
  confidence: { overall: string; details: string };
}

export default function NewRulePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AiAnalysis | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");
  const [editedSteps, setEditedSteps] = useState<any[]>([]);
  const [editedMapping, setEditedMapping] = useState<any>({});
  const [saving, setSaving] = useState(false);

  // 上传配置
  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    maxCount: 1,
    accept: ".xlsx,.xls,.docx,.pdf",
    beforeUpload: (file) => {
      const isValid = /\.(xlsx|xls|docx|pdf)$/i.test(file.name);
      if (!isValid) {
        message.error("不支持的文件格式");
        return false;
      }
      if (file.size > 20 * 1024 * 1024) {
        message.error("文件大小不能超过 20MB");
        return false;
      }
      setFile(file);
      return false;
    },
    onRemove: () => {
      setFile(null);
      setAnalysisResult(null);
      setAiError(null);
    },
  };

  // AI 分析文件
  const handleAnalyze = async () => {
    if (!file) return;

    setAnalyzing(true);
    setAiError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.success && data.data.analysis) {
        setAnalysisResult(data.data.analysis);
        setEditedSteps(data.data.analysis.steps || []);
        setEditedMapping(data.data.analysis.fieldMapping || {});
        if (!ruleName) {
          setRuleName(`${file.name.split(".")[0]} 解析规则`);
        }
        message.success("AI 分析完成");
        setCurrentStep(1);
      } else if (data.data?.aiError) {
        setAiError(data.data.aiError);
        message.warning(data.data.aiError);
        setCurrentStep(1);
      } else {
        setAiError(data.error || "分析失败");
        message.error(data.error || "AI 分析失败");
      }
    } catch {
      setAiError("AI 服务调用失败");
      message.error("AI 服务调用失败");
    } finally {
      setAnalyzing(false);
    }
  };

  // 更新 step 配置
  const updateStepConfig = (stepIdx: number, field: string, value: any) => {
    setEditedSteps((prev) => {
      const next = [...prev];
      next[stepIdx] = { ...next[stepIdx], config: { ...next[stepIdx].config, [field]: value } };
      return next;
    });
  };

  // 更新字段映射
  const updateMapping = (targetField: string, stepId: string, fieldPath: string) => {
    setEditedMapping((prev: any) => ({
      ...prev,
      [targetField]: { stepId, fieldPath },
    }));
  };

  // 保存规则
  const handleSave = async () => {
    if (!ruleName.trim()) {
      message.error("请输入规则名称");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName,
          description: ruleDescription,
          steps: editedSteps,
          fieldMapping: editedMapping,
          createdByLlm: !!analysisResult,
        }),
      });
      const data = await res.json();

      if (data.success) {
        message.success("规则保存成功");
        router.push("/rules");
      } else {
        message.error(data.error || "保存失败");
      }
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const confidenceColor = (level: string) => {
    switch (level) {
      case "high": return "green";
      case "medium": return "orange";
      case "low": return "red";
      default: return "default";
    }
  };

  const fields = [
    { name: "externalCode", label: "外部编码" },
    { name: "storeName", label: "收货门店" },
    { name: "receiverName", label: "收件人姓名" },
    { name: "receiverPhone", label: "收件人电话" },
    { name: "receiverAddress", label: "收件人地址" },
    { name: "skuCode", label: "SKU编码 (必填)" },
    { name: "skuName", label: "SKU名称 (必填)" },
    { name: "quantity", label: "发货数量 (必填)" },
    { name: "specification", label: "规格型号" },
    { name: "remark", label: "备注" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push("/rules")}
          type="text"
          style={{ marginBottom: 8 }}
        >
          返回规则列表
        </Button>
        <Title level={4} style={{ margin: 0 }}>
          新建解析规则
        </Title>
      </div>

      <Steps
        current={currentStep}
        items={[
          { title: "上传文件", icon: <InboxOutlined /> },
          { title: "AI 分析", icon: <RobotOutlined /> },
          { title: "确认保存", icon: <SaveOutlined /> },
        ]}
        style={{ marginBottom: 32 }}
      />

      {/* Step 0: 上传 */}
      {currentStep === 0 && (
        <Card style={{ borderRadius: 12 }}>
          <Dragger {...uploadProps} style={{ padding: "30px 0" }}>
            <InboxOutlined style={{ fontSize: 48, color: "#0fc6c2" }} />
            <p style={{ fontSize: 16, marginTop: 12 }}>上传样例文件</p>
            <p style={{ color: "#999" }}>用于 AI 分析文件结构，生成推荐规则</p>
          </Dragger>

          {file && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <Text strong>{file.name}</Text>
              <br />
              <Button
                type="primary"
                onClick={handleAnalyze}
                loading={analyzing}
                icon={<RobotOutlined />}
                style={{ marginTop: 12 }}
                size="large"
              >
                AI 分析文件结构
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Step 1: AI 分析结果 + 编辑 */}
      {currentStep >= 1 && (
        <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>
          {/* AI 分析结果 */}
          {analysisResult && (
            <Card
              title={
                <Space>
                  <RobotOutlined style={{ color: "#0fc6c2" }} />
                  <span>AI 分析结果</span>
                  <Tag color={confidenceColor(analysisResult.confidence?.overall)}>
                    置信度: {analysisResult.confidence?.overall || "未知"}
                  </Tag>
                </Space>
              }
              style={{ borderRadius: 12 }}
            >
              <Paragraph>{analysisResult.analysis}</Paragraph>
              {analysisResult.confidence?.details && (
                <Paragraph type="secondary">
                  {analysisResult.confidence.details}
                </Paragraph>
              )}
            </Card>
          )}

          {/* AI 失败时的提示 */}
          {aiError && (
            <Alert
              message="AI 分析失败"
              description="AI 服务暂时不可用，请手动配置规则步骤和字段映射"
              type="warning"
              showIcon
              style={{ borderRadius: 8 }}
            />
          )}

          {/* 规则名称和描述 */}
          <Card title="基本信息" style={{ borderRadius: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <Text strong style={{ display: "block", marginBottom: 4 }}>
                  规则名称 *
                </Text>
                <Input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="例如：黎明屯配送单解析规则"
                />
              </div>
              <div>
                <Text strong style={{ display: "block", marginBottom: 4 }}>
                  规则描述
                </Text>
                <TextArea
                  value={ruleDescription}
                  onChange={(e) => setRuleDescription(e.target.value)}
                  rows={2}
                  placeholder="描述此规则适用的文件格式"
                />
              </div>
            </div>
          </Card>

          {/* 提取步骤配置 */}
          <Card
            title={
              <Space>
                <EditOutlined />
                <span>提取步骤配置</span>
              </Space>
            }
            style={{ borderRadius: 12 }}
          >
            {editedSteps.length === 0 ? (
              <Empty description="暂无步骤，请添加" />
            ) : (
              <Collapse
                items={editedSteps.map((step, stepIdx) => ({
                  key: step.id || `step-${stepIdx}`,
                  label: (
                    <Space>
                      <Tag color="#0fc6c2">{step.type}</Tag>
                      <span>{step.label || `步骤 ${stepIdx + 1}`}</span>
                    </Space>
                  ),
                  children: (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <Text strong style={{ display: "block", marginBottom: 4 }}>
                          步骤名称
                        </Text>
                        <Input
                          value={step.label || ""}
                          onChange={(e) => {
                            setEditedSteps((prev) => {
                              const next = [...prev];
                              next[stepIdx] = { ...next[stepIdx], label: e.target.value };
                              return next;
                            });
                          }}
                        />
                      </div>

                      {step.type === "standard-table" && (
                        <>
                          <Descriptions column={2} size="small">
                            <Descriptions.Item label="表头行号">
                              <Input
                                size="small"
                                type="number"
                                value={step.config?.headerRow ?? 0}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "headerRow", Number(e.target.value))
                                }
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="数据起始行">
                              <Input
                                size="small"
                                type="number"
                                value={step.config?.dataStartRow ?? 0}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "dataStartRow", Number(e.target.value))
                                }
                              />
                            </Descriptions.Item>
                          </Descriptions>
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              列名映射 (JSON 格式)
                            </Text>
                            <TextArea
                              rows={3}
                              value={JSON.stringify(step.config?.columnMapping || {}, null, 2)}
                              onChange={(e) => {
                                try {
                                  const parsed = JSON.parse(e.target.value);
                                  updateStepConfig(stepIdx, "columnMapping", parsed);
                                } catch {}
                              }}
                            />
                          </div>
                        </>
                      )}

                      {step.type === "matrix-transpose" && (
                        <>
                          <Descriptions column={2} size="small">
                            <Descriptions.Item label="列头所在行">
                              <Input
                                size="small"
                                type="number"
                                value={step.config?.colHeaderRow ?? 0}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "colHeaderRow", Number(e.target.value))
                                }
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="列头字段名">
                              <Input
                                size="small"
                                value={step.config?.colHeaderName ?? ""}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "colHeaderName", e.target.value)
                                }
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="数据起始行">
                              <Input
                                size="small"
                                type="number"
                                value={step.config?.dataStartRow ?? 0}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "dataStartRow", Number(e.target.value))
                                }
                              />
                            </Descriptions.Item>
                            <Descriptions.Item label="数据起始列">
                              <Input
                                size="small"
                                type="number"
                                value={step.config?.dataStartCol ?? 0}
                                onChange={(e) =>
                                  updateStepConfig(stepIdx, "dataStartCol", Number(e.target.value))
                                }
                              />
                            </Descriptions.Item>
                          </Descriptions>
                        </>
                      )}

                      {step.type === "card-split" && (
                        <div>
                          <Text strong style={{ display: "block", marginBottom: 4 }}>
                            卡片标记文本
                          </Text>
                          <Input
                            value={step.config?.cardMarker ?? ""}
                            onChange={(e) =>
                              updateStepConfig(stepIdx, "cardMarker", e.target.value)
                            }
                          />
                        </div>
                      )}

                      {step.type === "text-regex" && (
                        <div>
                          <Text strong style={{ display: "block", marginBottom: 4 }}>
                            记录分隔符
                          </Text>
                          <Input
                            value={step.config?.recordSeparator ?? ""}
                            onChange={(e) =>
                              updateStepConfig(stepIdx, "recordSeparator", e.target.value)
                            }
                          />
                        </div>
                      )}

                      {/* 其他 step 类型的通用 JSON 配置 */}
                      {!["standard-table", "matrix-transpose", "card-split", "text-regex"].includes(step.type) && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            完整配置 (JSON)
                          </Text>
                          <TextArea
                            rows={4}
                            value={JSON.stringify(step.config || {}, null, 2)}
                            onChange={(e) => {
                              try {
                                updateStepConfig(stepIdx, "__full", JSON.parse(e.target.value));
                              } catch {}
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>

          {/* 字段映射配置 */}
          <Card
            title={
              <Space>
                <EditOutlined />
                <span>字段映射配置</span>
              </Space>
            }
            style={{ borderRadius: 12 }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              {fields.map((field) => {
                const mapping = editedMapping?.[field.name];
                const isAiInferred = mapping?.aiInferred;
                const confidence = mapping?.aiConfidence;

                return (
                  <div
                    key={field.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 12px",
                      background: isAiInferred ? "#fffbe6" : "transparent",
                      borderRadius: 8,
                    }}
                  >
                    <Text
                      style={{
                        width: 140,
                        fontWeight: field.label.includes("必填") ? 600 : 400,
                      }}
                    >
                      {field.label}
                      {field.label.includes("必填") && (
                        <Text type="danger"> *</Text>
                      )}
                    </Text>
                    <Select
                      style={{ width: 160 }}
                      placeholder="选择步骤"
                      value={mapping?.stepId || undefined}
                      onChange={(val) =>
                        updateMapping(field.name, val, mapping?.fieldPath || "")
                      }
                    >
                      {editedSteps
                        .filter((s) => s.id)
                        .map((s) => (
                          <Option key={s.id} value={s.id}>
                            {s.label || s.id}
                          </Option>
                        ))}
                    </Select>
                    <Input
                      style={{ width: 200 }}
                      placeholder="字段路径 (如 SKU编码)"
                      value={mapping?.fieldPath || ""}
                      onChange={(e) =>
                        updateMapping(field.name, mapping?.stepId || "", e.target.value)
                      }
                    />
                    {isAiInferred && (
                      <Tag color={confidenceColor(confidence || "medium")}>
                        AI 推测
                      </Tag>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* 保存按钮 */}
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <Space>
              <Button onClick={() => router.push("/rules")}>取消</Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
                size="large"
              >
                保存规则
              </Button>
            </Space>
          </div>
        </div>
      )}
    </div>
  );
}

// 补一个 Empty 组件引用
function Empty({ description }: { description: string }) {
  return (
    <div style={{ textAlign: "center", padding: 32, color: "#999" }}>
      {description}
    </div>
  );
}

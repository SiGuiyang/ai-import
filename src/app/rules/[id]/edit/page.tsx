"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  Button,
  Input,
  Typography,
  Space,
  message,
  Tag,
  Collapse,
  Select,
  Spin,
} from "antd";
import {
  SaveOutlined,
  ArrowLeftOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useParams, useRouter } from "next/navigation";

const { Title, Text } = Typography;
const { TextArea } = Input;
const { Option } = Select;

export default function EditRulePage() {
  const params = useParams();
  const router = useRouter();
  const ruleId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");
  const [steps, setSteps] = useState<any[]>([]);
  const [fieldMapping, setFieldMapping] = useState<any>({});

  useEffect(() => {
    fetchRule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId]);

  const fetchRule = async () => {
    try {
      const res = await fetch(`/api/rules/${ruleId}`);
      const data = await res.json();
      if (data.success) {
        setRuleName(data.data.name);
        setRuleDescription(data.data.description || "");
        setSteps(data.data.steps || []);
        setFieldMapping(data.data.fieldMapping || {});
      }
    } catch {
      message.error("获取规则失败");
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (
    targetField: string,
    stepId: string,
    fieldPath: string
  ) => {
    setFieldMapping((prev: any) => ({
      ...prev,
      [targetField]: { stepId, fieldPath },
    }));
  };

  const handleSave = async () => {
    if (!ruleName.trim()) {
      message.error("请输入规则名称");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: ruleName,
          description: ruleDescription,
          steps,
          fieldMapping,
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success("保存成功");
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

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 64 }}>
        <Spin size="large" />
      </div>
    );
  }

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
          编辑解析规则
        </Title>
      </div>

      <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>
        {/* 基本信息 */}
        <Card title="基本信息" style={{ borderRadius: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Text strong>规则名称 *</Text>
              <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
            </div>
            <div>
              <Text strong>规则描述</Text>
              <TextArea
                value={ruleDescription}
                onChange={(e) => setRuleDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </Card>

        {/* 步骤编辑 */}
        <Card
          title={
            <Space>
              <EditOutlined />
              <span>提取步骤配置</span>
            </Space>
          }
          style={{ borderRadius: 12 }}
        >
          {steps.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "#999" }}>
              暂无步骤
            </div>
          ) : (
            <Collapse
              items={steps.map((step: any, stepIdx: number) => ({
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
                          setSteps((prev: any[]) => {
                            const next = [...prev];
                            next[stepIdx] = { ...next[stepIdx], label: e.target.value };
                            return next;
                          });
                        }}
                      />
                    </div>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        完整配置 (JSON)
                      </Text>
                      <TextArea
                        rows={4}
                        value={JSON.stringify(step.config || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            setSteps((prev: any[]) => {
                              const next = [...prev];
                              next[stepIdx] = {
                                ...next[stepIdx],
                                config: JSON.parse(e.target.value),
                              };
                              return next;
                            });
                          } catch {}
                        }}
                      />
                    </div>
                  </div>
                ),
              }))}
            />
          )}
        </Card>

        {/* 字段映射 */}
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
              const mapping = fieldMapping?.[field.name];
              const isAiInferred = mapping?.aiInferred;

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
                  <Text style={{ width: 140, fontWeight: field.label.includes("必填") ? 600 : 400 }}>
                    {field.label}
                    {field.label.includes("必填") && <Text type="danger"> *</Text>}
                  </Text>
                  <Select
                    style={{ width: 160 }}
                    placeholder="选择步骤"
                    value={mapping?.stepId || undefined}
                    onChange={(val) => updateMapping(field.name, val, mapping?.fieldPath || "")}
                  >
                    {steps.filter((s: any) => s.id).map((s: any) => (
                      <Option key={s.id} value={s.id}>{s.label || s.id}</Option>
                    ))}
                  </Select>
                  <Input
                    style={{ width: 200 }}
                    placeholder="字段路径"
                    value={mapping?.fieldPath || ""}
                    onChange={(e) =>
                      updateMapping(field.name, mapping?.stepId || "", e.target.value)
                    }
                  />
                  {isAiInferred && <Tag color="orange">AI 推测</Tag>}
                </div>
              );
            })}
          </div>
        </Card>

        <div style={{ textAlign: "center" }}>
          <Space>
            <Button onClick={() => router.push("/rules")}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} size="large">
              保存修改
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
}

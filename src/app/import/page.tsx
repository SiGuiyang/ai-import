"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  Upload,
  Button,
  Select,
  Space,
  Typography,
  message,
  Progress,
  Steps,
  Empty,
  Descriptions,
} from "antd";
import {
  InboxOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { UploadProps } from "antd";

const { Dragger } = Upload;
const { Title, Text } = Typography;

interface RuleOption {
  id: string;
  name: string;
  description: string;
}

export default function ImportPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleOption[]>([]);
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  // 获取规则列表
  useEffect(() => {
    fetch("/api/rules")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRules(data.data);
      })
      .catch(() => message.error("获取规则列表失败"));
  }, []);

  // 文件上传配置
  const uploadProps: UploadProps = {
    name: "file",
    multiple: false,
    maxCount: 1,
    accept: ".xlsx,.xls,.docx,.pdf",
    beforeUpload: (file) => {
      const isValid = /\.(xlsx|xls|docx|pdf)$/i.test(file.name);
      if (!isValid) {
        message.error("不支持的文件格式，请上传 .xlsx .xls .docx .pdf 文件");
        return false;
      }
      if (file.size > 20 * 1024 * 1024) {
        message.error("文件大小不能超过 20MB");
        return false;
      }
      setFile(file);
      return false; // 阻止自动上传
    },
    onRemove: () => {
      setFile(null);
      setStep(0);
    },
  };

  // 上传文件到服务器
  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setImportId(data.data.id);
        setStep(1);
        message.success("文件上传成功");
      } else {
        message.error(data.error || "上传失败");
      }
    } catch {
      message.error("上传失败");
    }
  };

  // 开始解析
  const handleParse = async () => {
    if (!importId || !selectedRule) return;

    // 更新 import 的 ruleId
    setParsing(true);
    setParseError(null);

    try {
      const eventSource = new EventSource(
        `/api/import/${importId}/parse?ruleId=${selectedRule}`
      );

      eventSource.addEventListener("progress", (event) => {
        const data = JSON.parse(event.data);
        setProgress(data.percent);
        setProgressMessage(data.message);
      });

      eventSource.addEventListener("complete", (event) => {
        const data = JSON.parse(event.data);
        eventSource.close();
        setParsing(false);
        message.success(`解析完成，共 ${data.parsedRows} 条记录`);
        router.push(`/import/${importId}/preview`);
      });

      // 应用层解析错误（event: parse-error）
      eventSource.addEventListener("parse-error", (event: MessageEvent) => {
        const data = JSON.parse(event.data || "{}");
        eventSource.close();
        setParsing(false);
        setParseError(data.message || "解析失败");
        message.error(data.message || "解析失败");
      });

      // 连接层错误（SSE 连接关闭/异常）
      eventSource.onerror = () => {
        eventSource.close();
        setParsing(false);
      };
    } catch {
      setParsing(false);
      setParseError("解析启动失败");
    }
  };

  const getFileIcon = () => {
    if (!file) return <InboxOutlined style={{ fontSize: 48, color: "#0fc6c2" }} />;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "pdf")
      return <FilePdfOutlined style={{ fontSize: 32, color: "#ff4d4f" }} />;
    if (ext === "docx")
      return <FileWordOutlined style={{ fontSize: 32, color: "#1890ff" }} />;
    return <FileExcelOutlined style={{ fontSize: 32, color: "#52c41a" }} />;
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        导入出库单文件
      </Title>

      <Steps
        current={step}
        items={[
          { title: "上传文件", icon: <InboxOutlined /> },
          { title: "选择规则", icon: <CheckCircleOutlined /> },
          { title: "执行解析", icon: <CheckCircleOutlined /> },
        ]}
        style={{ marginBottom: 32 }}
      />

      {/* Step 0: 上传文件 */}
      {step === 0 && (
        <Card style={{ borderRadius: 12 }}>
          <Dragger
            {...uploadProps}
            style={{ padding: "40px 0" }}
          >
            <p className="text-5xl mb-4">{getFileIcon()}</p>
            <p className="text-lg mb-2">点击或拖拽文件到此区域上传</p>
            <p className="text-gray-400">支持 .xlsx .xls .docx .pdf 格式，最大 20MB</p>
          </Dragger>

          {file && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <Space>
                <Text strong>{file.name}</Text>
                <Text type="secondary">({(file.size / 1024).toFixed(1)} KB)</Text>
              </Space>
              <br />
              <Button type="primary" onClick={handleUpload} style={{ marginTop: 12 }}>
                确认上传
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Step 1: 选择规则 */}
      {step === 1 && (
        <Card style={{ borderRadius: 12 }}>
          <Descriptions
            title="已上传文件"
            column={1}
            style={{ marginBottom: 24 }}
          >
            <Descriptions.Item label="文件名">{file?.name}</Descriptions.Item>
            <Descriptions.Item label="大小">
              {((file?.size || 0) / 1024).toFixed(1)} KB
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              选择解析规则
            </Text>
            <Select
              placeholder="请选择解析规则"
              style={{ width: 400 }}
              value={selectedRule}
              onChange={setSelectedRule}
              options={rules.map((r) => ({
                value: r.id,
                label: r.name,
              }))}
              notFoundContent={<Empty description="暂无规则" />}
            />
          </div>

          <Space>
            <Button
              type="primary"
              onClick={handleParse}
              disabled={!selectedRule || parsing}
            >
              开始解析
            </Button>
            <Button onClick={() => router.push("/rules/new")}>新建规则</Button>
          </Space>
        </Card>
      )}

      {/* 解析进度 */}
      {parsing && (
        <Card style={{ borderRadius: 12, marginTop: 16 }}>
          <Title level={5}>正在解析...</Title>
          <Progress percent={progress} status="active" />
          <Text type="secondary">{progressMessage}</Text>
        </Card>
      )}

      {/* 解析失败 */}
      {parseError && (
        <Card style={{ borderRadius: 12, marginTop: 16 }}>
          <Space>
            <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 24 }} />
            <div>
              <Text type="danger" strong>
                解析失败
              </Text>
              <br />
              <Text type="secondary">{parseError}</Text>
            </div>
          </Space>
          <br />
          <Button
            type="primary"
            style={{ marginTop: 12 }}
            onClick={() => router.push("/rules/new")}
          >
            配置新规则
          </Button>
        </Card>
      )}
    </div>
  );
}

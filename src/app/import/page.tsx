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
  Empty,
} from "antd";
import {
  InboxOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileWordOutlined,
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
  const [file, setFile] = useState<File | null>(null);
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
    },
  };

  // 开始解析（V4 异步流程：直接 POST 文件+规则到 import-tasks）
  const handleParse = async () => {
    if (!file || !selectedRule) return;

    setParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ruleId", selectedRule);

      const res = await fetch("/api/import-tasks", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.taskId) {
        message.success("任务已创建，正在异步解析中");
        // 跳转到 V4 异步进度页
        router.push(`/import/${data.taskId}/progress`);
      } else {
        setParsing(false);
        const errMsg = data.error || "任务创建失败";
        setParseError(errMsg);
        message.error(errMsg);
      }
    } catch {
      setParsing(false);
      setParseError("任务创建失败");
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

      {/* 上传文件 */}
      <Card style={{ borderRadius: 12, marginBottom: 16 }}>
        <Text strong style={{ display: "block", marginBottom: 12 }}>
          1. 上传文件
        </Text>
        <Dragger
          {...uploadProps}
          style={{ padding: "40px 0" }}
        >
          <p className="text-5xl mb-4">{getFileIcon()}</p>
          <p className="text-lg mb-2">点击或拖拽文件到此区域上传</p>
          <p className="text-gray-400">支持 .xlsx .xls .docx .pdf 格式，最大 20MB</p>
        </Dragger>

        {file && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <Space>
              <Text strong>{file.name}</Text>
              <Text type="secondary">({(file.size / 1024).toFixed(1)} KB)</Text>
            </Space>
          </div>
        )}
      </Card>

      {/* 选择规则 */}
      <Card style={{ borderRadius: 12, marginBottom: 16 }}>
        <Text strong style={{ display: "block", marginBottom: 12 }}>
          2. 选择解析规则
        </Text>
        <Select
          placeholder="请选择解析规则"
          style={{ width: "100%", maxWidth: 500 }}
          value={selectedRule}
          onChange={(val) => {
            setSelectedRule(val);
            setParseError(null);
          }}
          options={rules.map((r) => ({
            value: r.id,
            label: r.name,
          }))}
          notFoundContent={<Empty description="暂无规则" />}
        />
        <div style={{ marginTop: 12 }}>
          <Button
            size="small"
            type="link"
            onClick={() => router.push("/rules/new")}
            style={{ padding: 0 }}
          >
            + 新建解析规则
          </Button>
        </div>
      </Card>

      {/* 解析进度 */}
      {parsing && (
        <Card style={{ borderRadius: 12, marginBottom: 16 }}>
          <Title level={5}>正在创建任务...</Title>
          <Progress percent={progress} status="active" />
          <Text type="secondary">{progressMessage}</Text>
        </Card>
      )}

      {/* 解析失败 */}
      {parseError && (
        <Card style={{ borderRadius: 12, marginBottom: 16 }}>
          <Space>
            <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 24 }} />
            <div>
              <Text type="danger" strong>
                解析提交失败
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

      {/* 提交按钮 */}
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <Button
          type="primary"
          size="large"
          disabled={!file || !selectedRule}
          loading={parsing}
          onClick={handleParse}
        >
          开始解析
        </Button>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Input, Space, message, Popconfirm, Tag, Typography } from "antd";
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";

const { Title } = Typography;

interface ParsingRule {
  id: string;
  name: string;
  description: string;
  createdByLlm: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function RulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<ParsingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`/api/rules${query}`);
      const data = await res.json();
      if (data.success) {
        setRules(data.data);
      }
    } catch {
      message.error("获取规则列表失败");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        message.success("删除成功");
        fetchRules();
      } else {
        message.error(data.error || "删除失败");
      }
    } catch {
      message.error("删除失败");
    }
  };

  const handleCopy = async (id: string) => {
    try {
      const res = await fetch(`/api/rules/${id}/copy`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        message.success("复制成功");
        fetchRules();
      } else {
        message.error(data.error || "复制失败");
      }
    } catch {
      message.error("复制失败");
    }
  };

  const columns: any[] = [
    {
      title: "规则名称",
      dataIndex: "name",
      key: "name",
      render: (text: string, record: ParsingRule) => (
        <Space>
          <span style={{ fontWeight: 500 }}>{text}</span>
          {record.createdByLlm && (
            <Tag color="#0fc6c2" style={{ fontSize: 12 }}>
              AI 生成
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: "描述",
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (text: string) => text || "-",
    },
    {
      title: "使用次数",
      dataIndex: "usageCount",
      key: "usageCount",
      width: 100,
      align: "center" as const,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (text: string) => dayjs(text).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (text: string) => dayjs(text).format("YYYY-MM-DD HH:mm"),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_: any, record: ParsingRule) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => router.push(`/rules/${record.id}/edit`)}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(record.id)}
          >
            复制
          </Button>
          <Popconfirm
            title="确定删除此规则？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          解析规则管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push("/rules/new")}>
          新建规则
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索规则名称"
          prefix={<SearchOutlined />}
          style={{ width: 300 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={fetchRules}
          allowClear
        />
      </div>

      <Table
        columns={columns}
        dataSource={rules}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        locale={{ emptyText: "暂无规则，点击新建规则创建" }}
      />
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Typography } from "antd";
import {
  UploadOutlined,
  SettingOutlined,
  OrderedListOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";

const { Title, Paragraph } = Typography;

const actionCards = [
  {
    key: "import",
    title: "导入文件",
    description: "上传出库单文件，选择解析规则进行智能解析",
    icon: <UploadOutlined style={{ fontSize: 40, color: "#0fc6c2" }} />,
    path: "/import",
    color: "#e6faf9",
  },
  {
    key: "rules",
    title: "管理规则",
    description: "创建和编辑解析规则，支持 AI 辅助生成",
    icon: <SettingOutlined style={{ fontSize: 40, color: "#0fc6c2" }} />,
    path: "/rules",
    color: "#e6faf9",
  },
  {
    key: "orders",
    title: "查看运单",
    description: "浏览已导入的运单记录，支持搜索和筛选",
    icon: <OrderedListOutlined style={{ fontSize: 40, color: "#0fc6c2" }} />,
    path: "/orders",
    color: "#e6faf9",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [stats, setStats] = useState({ todayImportCount: 0, rulesCount: 0, ordersCount: 0 });

  useEffect(() => {
    fetch("/api/dashboard/stats", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => data && setStats(data))
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <Title level={3} style={{ marginBottom: 8 }}>
          欢迎使用鲸天 AI 智能导入系统
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 15 }}>
          通过大模型智能解析任意格式的出库单文件，实现批量下单流程自动化
        </Paragraph>
      </div>

      <Row gutter={[24, 24]}>
        {actionCards.map((card) => (
          <Col xs={24} sm={12} lg={8} key={card.key}>
            <Card
              hoverable
              onClick={() => router.push(card.path)}
              style={{
                borderRadius: 12,
                borderColor: "#f0f0f0",
                cursor: "pointer",
                height: "100%",
              }}
              styles={{
                body: {
                  padding: 32,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                },
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 20,
                  background: card.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 20,
                }}
              >
                {card.icon}
              </div>
              <Title level={4} style={{ marginBottom: 8 }}>
                {card.title}
              </Title>
              <Paragraph type="secondary">{card.description}</Paragraph>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[24, 24]} style={{ marginTop: 32 }}>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="今日导入"
              value={stats.todayImportCount}
              prefix={<FileTextOutlined />}
              valueStyle={{ color: "#0fc6c2" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="解析规则数"
              value={stats.rulesCount}
              prefix={<SettingOutlined />}
              valueStyle={{ color: "#0fc6c2" }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 12 }}>
            <Statistic
              title="总运单数"
              value={stats.ordersCount}
              prefix={<OrderedListOutlined />}
              valueStyle={{ color: "#0fc6c2" }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

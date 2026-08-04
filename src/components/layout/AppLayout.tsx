"use client";

import React, { useState } from "react";
import { Layout, Menu, Typography } from "antd";
import {
  DashboardOutlined,
  UploadOutlined,
  SettingOutlined,
  OrderedListOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

const menuItems = [
  {
    key: "/",
    icon: <DashboardOutlined />,
    label: "仪表盘",
  },
  {
    key: "/rules",
    icon: <SettingOutlined />,
    label: "规则管理",
  },
  {
    key: "/import",
    icon: <UploadOutlined />,
    label: "导入文件",
  },
  {
    key: "/orders",
    icon: <OrderedListOutlined />,
    label: "运单列表",
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = "/" + (pathname.split("/")[1] || "");

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        width={220}
        style={{
          borderRight: "1px solid #f0f0f0",
          boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Title
            level={4}
            style={{
              margin: 0,
              color: "#0fc6c2",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {collapsed ? "AI" : "AI 智能导入"}
          </Title>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ borderRight: 0, marginTop: 8 }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 32px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            height: 64,
          }}
        >
          <Title level={5} style={{ margin: 0, color: "#555" }}>
            物流出库单智能解析与批量下单系统
          </Title>
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
            background: "#fff",
            borderRadius: 12,
            minHeight: 280,
            overflow: "auto",
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}

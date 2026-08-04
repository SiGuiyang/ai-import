'use client';

import "./globals.css";
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';

const theme = {
  token: {
    colorPrimary: '#0fc6c2',
    colorPrimaryHover: '#0bada9',
    colorPrimaryActive: '#099b97',
    borderRadius: 8,
    fontFamily: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
  },
  components: {
    Card: {
      paddingLG: 24,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <title>万能导入 V2</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <ConfigProvider locale={zhCN} theme={theme}>
          <AntApp>
            {children}
          </AntApp>
        </ConfigProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgoraFab · 智协工坊',
  description: '人类与独立 Agent 的协作社区。M0 基础环境测试。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

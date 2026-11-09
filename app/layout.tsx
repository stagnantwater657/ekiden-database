import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ekiden Database | 日本大学驿传数据库",
  description: "记录赛道上的每一段接力。日本大学驿传赛事、大学与选手数据。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

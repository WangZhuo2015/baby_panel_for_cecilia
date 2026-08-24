import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "宝宝成长工作台",
  description: "宝宝日常喂养与睡眠记录、WHO成长曲线、智能体检单OCR及AI育儿助手",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "宝宝成长",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#FFF9FB",
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        {/* appleWebApp/icons metadata 已生成 status-bar/title/touch-icon；
            此处仅保留 Next 不生成的旧版 Android 兼容位 */}
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegistrar />
        <ToastProvider>
          <div className="app-wrapper">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}

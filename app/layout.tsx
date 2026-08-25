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
    // 内容延伸到状态栏/灵动岛之下（env(safe-area-inset-top) 才会生效），
    // 由各页 safe-top/pt-safe-6 自行避让；文字颜色随系统深浅自动反白
    statusBarStyle: "black-translucent",
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
    interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF9FB" },
    { media: "(prefers-color-scheme: dark)", color: "#171216" },
  ],
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
        {/* 防闪脚本：在首帧渲染前根据持久化/系统偏好挂载 dark class */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('baby-theme');if(!t){t=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
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

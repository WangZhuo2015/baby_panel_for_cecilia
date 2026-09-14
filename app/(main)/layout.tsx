"use client";

import { usePathname } from "next/navigation";
import { useEffect, Suspense } from "react";
import { BottomNav } from "@/components/navigation/BottomNav";
import { DesktopSidebar } from "@/components/navigation/DesktopSidebar";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { QuickAiHost } from "@/components/ui/QuickAiHost";
import { RecordDrawerHost } from "@/components/records/RecordDrawerHost";
import { SmartPollingHost } from "@/components/ui/SmartPollingHost";
import { AgentVoiceResultHost } from "@/components/ui/AgentVoiceResultHost";
import { useBabyStore } from "@/stores/useBabyStore";

const hideNavRoutes = [
  "/records/feeding",
  "/records/sleep",
  "/records/diaper",
  "/growth/add",
  "/food/log",
];

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const user = useBabyStore((s) => s.user);
  const fetchBaby = useBabyStore((s) => s.fetchBaby);
  const hideNav = hideNavRoutes.includes(pathname);

  useEffect(() => {
    if (user && !useBabyStore.getState().baby) fetchBaby();
  }, [user, fetchBaby]);

  return (
    <div className="flex min-h-[100dvh] w-full">
      {/* 桌面端 / iPad 宽屏导航中枢 */}
      <DesktopSidebar />

      {/* 主舞台区域 */}
      <div className="flex-1 flex flex-col min-w-0 tablet-landscape:pl-56 lg:pl-64 transition-all">
        <OfflineBanner />
        <main
          className={`flex-1 ${hideNav ? "pb-4" : "pb-24 workbench:pb-8"}`}
        >
          {children}
        </main>
      </div>

      {/* 移动端底部导航（组件内已实现 workbench:hidden） */}
      {!hideNav && <BottomNav />}

      {/* 全局 AI 弹窗宿主 */}
      <QuickAiHost />

      {/* 全局快捷抽屉录入宿主 */}
      <RecordDrawerHost />

      {/* 全局前台智能轮询（防休眠、多端数据即时同步） */}
      <SmartPollingHost />

      {/* 语音 / Agent 异步执行反馈直出弹窗宿主 */}
      <Suspense fallback={null}>
        <AgentVoiceResultHost />
      </Suspense>
    </div>
  );
}

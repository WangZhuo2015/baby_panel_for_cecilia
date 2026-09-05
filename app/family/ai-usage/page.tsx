"use client";

import React, { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/ui/AppHeader";
import { AiUsageDashboard } from "@/components/mcp/AiUsageDashboard";

function AiUsageContent() {
  const searchParams = useSearchParams();
  const babyId = searchParams.get("babyId") || undefined;

  return (
    <div className="min-h-screen bg-bg-canvas px-4 pt-4 pb-28 max-w-4xl mx-auto">
      <AppHeader title="已连接 AI 与访问统计" showBack />
      <div className="mt-4">
        <AiUsageDashboard babyId={babyId} />
      </div>
    </div>
  );
}

export default function AiUsagePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-muted text-xs">加载 AI 统计看板中...</div>}>
      <AiUsageContent />
    </Suspense>
  );
}

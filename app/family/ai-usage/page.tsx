"use client";

import React from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { AiUsageDashboard } from "@/components/mcp/AiUsageDashboard";

export default function AiUsagePage() {
  return (
    <div className="min-h-screen bg-bg-canvas px-4 pt-4 pb-28 max-w-4xl mx-auto">
      <AppHeader title="已连接 AI 与访问统计" showBack />
      <div className="mt-4">
        <AiUsageDashboard />
      </div>
    </div>
  );
}

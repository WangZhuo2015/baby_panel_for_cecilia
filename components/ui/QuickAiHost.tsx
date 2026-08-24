"use client";

import React, { useEffect, useState } from "react";
import { QuickAiModal } from "@/components/ui/QuickAiModal";
import type { QuickAIOpenDetail } from "@/lib/quickai-bus";

/**
 * 全局 QuickAiModal 挂载点（挂在 (main) layout）：
 * TabBar 中央助手按钮通过 openQuickAI()（lib/quickai-bus）唤起。
 */
export const QuickAiHost: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [ctx, setCtx] = useState<QuickAIOpenDetail>({});

  useEffect(() => {
    const handler = (e: Event) => {
      setCtx((e as CustomEvent<QuickAIOpenDetail>).detail || {});
      setIsOpen(true);
    };
    window.addEventListener("quickai:open", handler);
    return () => window.removeEventListener("quickai:open", handler);
  }, []);

  return (
    <QuickAiModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      contextType={ctx.contextType ?? "general"}
      contextTitle={ctx.contextTitle ?? "AI 育儿助手"}
      contextDetail={ctx.contextDetail}
      initialPrompt={ctx.initialPrompt}
    />
  );
};

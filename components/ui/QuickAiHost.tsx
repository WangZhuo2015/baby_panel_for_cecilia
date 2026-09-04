"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { QuickAIOpenDetail } from "@/lib/quickai-bus";

const QuickAiModal = dynamic(
  () => import("@/components/ui/QuickAiModal").then((m) => m.QuickAiModal),
  { ssr: false }
);

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

    // 全局快捷键 ⌘K / Ctrl+K / Ctrl+J
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "j")) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("quickai:open", handler);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!isOpen) return null;

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

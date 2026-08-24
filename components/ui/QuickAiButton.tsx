"use client";

import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import type { AiContextType } from "./QuickAiModal";

// react-markdown 全家桶 ~52KB gzip，仅在真正打开 AI 对话时加载
const QuickAiModal = dynamic(
  () => import("./QuickAiModal").then((m) => m.QuickAiModal),
  { ssr: false }
);

interface QuickAiButtonProps {
  contextType: AiContextType;
  label?: string;
  contextTitle?: string;
  contextDetail?: string | object;
  initialPrompt?: string;
  variant?: "primary" | "outline" | "compact" | "badge";
  className?: string;
}

export const QuickAiButton: React.FC<QuickAiButtonProps> = ({
  contextType,
  label = "问问 AI",
  contextTitle,
  contextDetail,
  initialPrompt,
  variant = "primary",
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);

  let styleClasses = "inline-flex items-center gap-1 font-medium transition-all active:scale-95 cursor-pointer ";

  if (variant === "primary") {
    styleClasses += "bg-gradient-to-r from-primary to-pink-500 text-white text-xs px-3 py-1.5 rounded-full shadow-button hover:opacity-90 ";
  } else if (variant === "outline") {
    styleClasses += "bg-white text-primary border border-primary/30 text-xs px-2.5 py-1.5 rounded-full shadow-2xs hover:bg-primary-light/40 ";
  } else if (variant === "compact") {
    styleClasses += "bg-primary-light/80 text-primary text-[11px] px-2 py-1 rounded-lg hover:bg-primary-light ";
  } else if (variant === "badge") {
    styleClasses += "bg-pink-50 text-pink-600 border border-pink-200 text-[10px] px-2 py-0.5 rounded-full font-semibold ";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`${styleClasses} ${className}`}
        title={label}
      >
        <Sparkles size={12} className="shrink-0 animate-pulse text-amber-300" />
        <span>{label}</span>
      </button>

      <QuickAiModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        contextType={contextType}
        contextTitle={contextTitle}
        contextDetail={contextDetail}
        initialPrompt={initialPrompt}
      />
    </>
  );
};

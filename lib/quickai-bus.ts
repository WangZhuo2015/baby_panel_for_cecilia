import type { AiContextType } from "@/components/ui/QuickAiModal";

export interface QuickAIOpenDetail {
  contextType?: AiContextType;
  contextTitle?: string;
  contextDetail?: string | object;
  initialPrompt?: string;
}

/** 任意组件调用即可打开全局 AI 助手（TabBar 中央按钮等） */
export function openQuickAI(detail: QuickAIOpenDetail = {}): void {
  window.dispatchEvent(new CustomEvent("quickai:open", { detail }));
}

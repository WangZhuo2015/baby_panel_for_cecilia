import { llmModelLabel } from "@/lib/llm-display";

export function LlmModelLabel({ info, deterministic = false, className = "" }: { info?: unknown; deterministic?: boolean; className?: string }) {
  return <p className={`text-[11px] text-text-muted break-words ${className}`} aria-label="使用的模型">{llmModelLabel(info, deterministic)}</p>;
}

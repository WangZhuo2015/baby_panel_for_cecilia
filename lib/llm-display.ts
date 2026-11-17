export function llmModelLabel(info: unknown, deterministic = false): string {
  if (deterministic) return "规则统计 · 未调用模型";
  if (!info || typeof info !== "object" || !("model" in info) || typeof info.model !== "string" || !info.model) return "模型未知";
  const provider = "provider" in info && typeof info.provider === "string" ? info.provider : "";
  return provider ? `${provider} · ${info.model}` : info.model;
}

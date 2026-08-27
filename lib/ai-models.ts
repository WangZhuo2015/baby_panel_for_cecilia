/** Curated models - Muse Spark 1.2 contributor default, then GLM/MiniMax free */
export const FREE_MODEL_LIST = [
  { id: "muse-spark-1.2-contributor", label: "Muse Spark 1.2", provider: "OpenCode" },
  { id: "z-ai/glm-5.2:free", label: "GLM 5.2", provider: "Z.ai" },
  { id: "minimax/minimax-m3:free", label: "MiniMax M3", provider: "MiniMax" },
  { id: "minimax/minimax-m2.7:free", label: "MiniMax M2.7", provider: "MiniMax" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", provider: "Google" },
  { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B", provider: "Google" },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", label: "Nemotron 3 Nano", provider: "NVIDIA" },
  { id: "thinkingmachines/inkling:free", label: "Inkling", provider: "ThinkingMachines" },
] as const;

export const DEFAULT_FREE_MODEL = FREE_MODEL_LIST[0].id;

export function getFreeModelFallbackChain(): string[] {
  return FREE_MODEL_LIST.map(m => m.id);
}

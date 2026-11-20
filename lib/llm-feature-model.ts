import type { LlmFeature, LlmSelection } from "@/lib/llm-preferences";

export const OPENAI_OFFICIAL_PROFILE_ID = "openai-official";
export const AMD_V41_PROFILE_ID = "amd-v4.1-flash";

export function defaultLlmFeatureProfileId(feature: LlmFeature): string {
  return feature === "daily_summary" ? AMD_V41_PROFILE_ID : OPENAI_OFFICIAL_PROFILE_ID;
}

export function usesVisionModel(feature: LlmFeature): boolean {
  return feature === "nutrition_parse" || feature === "growth_ocr" || feature === "medical_ocr";
}

export function matchesLlmSelection(left?: LlmSelection, right?: LlmSelection): boolean {
  return Boolean(left && right && left.feature === right.feature && left.source === right.source
    && left.profileId === right.profileId && left.modelId === right.modelId);
}

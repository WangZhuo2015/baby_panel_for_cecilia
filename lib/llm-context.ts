import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import {
  type LlmFeature,
  type LlmModelInfo,
  type LlmSelection,
  getFeatureLlmSelection,
  getDefaultFeatureLlmSelection,
  LlmPreferenceError,
  validateLlmSelection,
} from "./llm-preferences";
import { AI_CONFIG } from "./config";
import {
  getActiveLlmProfile,
  getActiveLlmProfileId,
  getLlmProfileProvider,
  resolveLlmProfileModel,
  runWithLlmProfileScope,
} from "./llm-profiles";

export type { LlmFeature, LlmModelInfo, LlmSelection } from "./llm-preferences";

export interface LlmFeatureScope {
  owner: string;
  feature: LlmFeature;
  selection?: LlmSelection;
}

const featureScope = new AsyncLocalStorage<LlmFeatureScope>();

/** Resolve persisted per-user configuration and apply it only to this async request chain. */
export async function withLlmFeature<T>(
  owner: string,
  feature: LlmFeature,
  accessToken: string | undefined,
  work: () => T | Promise<T>,
): Promise<T> {
  const saved = await getFeatureLlmSelection(owner, feature, accessToken);
  const candidate = saved || getDefaultFeatureLlmSelection(feature);
  let selection: LlmSelection;
  try {
    selection = await validateLlmSelection(owner, candidate);
  } catch (error) {
    if (!saved && error instanceof LlmPreferenceError && error.code === "llm_profile_unavailable") {
      throw new LlmPreferenceError(503, "llm_profile_unavailable", "The default AI profile is not configured");
    }
    throw error;
  }
  const execute = () => featureScope.run({ owner, feature, selection }, work);
  if (selection?.source === "api") {
    return runWithLlmProfileScope(selection.profileId, selection.modelId, execute);
  }
  // Clear an enclosing profile scope when a nested operation has no API choice.
  return runWithLlmProfileScope(null, null, execute);
}

export function getCurrentLlmFeatureScope(): LlmFeatureScope | undefined {
  return featureScope.getStore();
}

/** Whether the trusted current feature has a usable selected backend. */
export function hasCurrentLlmConfiguration(): boolean {
  const selection = featureScope.getStore()?.selection;
  if (selection?.source === "chatgpt") return true;
  return Boolean(AI_CONFIG.apiKey);
}

/** Safe provenance for the model configured for this feature; actual provider replies may refine it. */
export function getCurrentLlmModelInfo(vision = false): LlmModelInfo | undefined {
  const scope = featureScope.getStore();
  if (!scope) return undefined;

  if (scope.selection?.source === "chatgpt") {
    return {
      source: "chatgpt",
      provider: "openai",
      model: scope.selection.modelId,
      profileId: scope.selection.profileId,
    };
  }

  const profile = getActiveLlmProfile();
  return {
    source: "api",
    provider: getLlmProfileProvider(profile),
    model: scope.selection?.modelId || resolveLlmProfileModel(profile, vision),
    profileId: scope.selection?.profileId || getActiveLlmProfileId(),
  };
}

/** Stable opaque cache namespace. It includes owner, feature, and effective model selection. */
export function getCurrentLlmCacheKey(): string | undefined {
  const scope = featureScope.getStore();
  if (!scope) return undefined;
  const identity = scope.selection
    ? {
        source: scope.selection.source,
        profileId: scope.selection.profileId,
        modelId: scope.selection.modelId,
      }
    : {
        source: "api",
        profileId: getActiveLlmProfileId(),
        textModel: resolveLlmProfileModel(getActiveLlmProfile()),
        visionModel: resolveLlmProfileModel(getActiveLlmProfile(), true),
      };
  return createHash("sha256")
    .update(JSON.stringify([scope.owner, scope.feature, identity]))
    .digest("hex");
}

/** Non-secret identity for logs and model caches that need the resolved scope fields. */
export function getCurrentLlmScopeIdentity(): {
  owner: string;
  feature: LlmFeature;
  source: "api" | "chatgpt";
  profileId: string;
  modelId: string;
} | undefined {
  const scope = featureScope.getStore();
  if (!scope) return undefined;
  const info = getCurrentLlmModelInfo();
  if (!info) return undefined;
  return {
    owner: scope.owner,
    feature: scope.feature,
    source: info.source,
    profileId: info.profileId || "default",
    modelId: info.model,
  };
}

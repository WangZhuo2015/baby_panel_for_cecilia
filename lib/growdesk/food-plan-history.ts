import { randomUUID } from "node:crypto";
import { BridgeError } from "./bridge-protocol";
import { readGrowDeskFoodPlan } from "./food-plan-state";
import { getLocalDateStr, isValidDateStr } from "../date";

export interface LegacyRecipe {
  id: string;
  babyId: string;
  date: string;
  name: string;
  tags: string[];
  nutrition: string;
  ingredients: string[];
  steps: string[];
  createdAt: string;
}
export interface PlanEnvelope {
  id: string | null;
  babyId: string;
  createdAt: string | null;
  version: string;
  planData: Record<string, unknown>;
}
function invalid(message: string, status = 502): never {
  throw new BridgeError(status, status === 400 ? "INVALID_RECIPE" : "UPSTREAM_INVALID_RESPONSE", message);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("饮食计划格式无效");
  return value as Record<string, unknown>;
}
export function readPlanEnvelope(value: unknown, babyId: string): PlanEnvelope {
  return readGrowDeskFoodPlan({ ok: true, status: 200, data: value }, babyId);
}
function strings(value: unknown, label: string, status: number): string[] {
  if (!Array.isArray(value) || value.length > 20 || value.some(x => typeof x !== "string" || !x.trim() || x.length > 500)) {
    invalid(`${label} 必须为不超过20项的非空字符串数组`, status);
  }
  return (value as string[]).map(x => x.trim());
}
function recipeFields(raw: Record<string, unknown>, status: number) {
  if (typeof raw.date !== "string" || !isValidDateStr(raw.date)) invalid("date 必须是有效的 YYYY-MM-DD 日期", status);
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 100) invalid("name 必须为 1-100 个字符", status);
  if (typeof raw.nutrition !== "string" || raw.nutrition.trim().length > 500) invalid("nutrition 必须为不超过500字符的文本", status);
  return {
    date: raw.date, name: raw.name.trim(),
    tags: strings(raw.tags, "tags", status), nutrition: raw.nutrition.trim(),
    ingredients: strings(raw.ingredients, "ingredients", status), steps: strings(raw.steps, "steps", status),
  };
}
export function readRecipeHistory(plan: PlanEnvelope): LegacyRecipe[] {
  const data = plan.planData;
  let values: unknown[];
  if (data.webRecipes !== undefined) {
    if (!Array.isArray(data.webRecipes)) invalid("食谱历史格式无效");
    values = data.webRecipes;
  } else if (data.date !== undefined) {
    // Upgrade the existing single recipe with its persisted container identity.
    if (!plan.id || !plan.createdAt) invalid("现有食谱缺少持久化标识或创建时间");
    values = [{ tags: [], ingredients: [], steps: [], nutrition: "营养均衡", ...data, id: plan.id, createdAt: plan.createdAt }];
  } else values = [];
  const seen = new Set<string>();
  return values.map(value => {
    const raw = object(value);
    if (typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) invalid("食谱历史标识无效或重复");
    seen.add(raw.id);
    if (raw.babyId !== undefined && raw.babyId !== plan.babyId) invalid("食谱历史宝宝范围不一致");
    if (typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) invalid("食谱创建时间无效");
    return { id: raw.id, babyId: plan.babyId, ...recipeFields(raw, 502), createdAt: raw.createdAt };
  });
}
export function createRecipe(body: Record<string, unknown>, babyId: string): LegacyRecipe {
  const fields = recipeFields({
    date: getLocalDateStr(), tags: [], ingredients: [], steps: [], nutrition: "营养均衡", ...body,
  }, 400);
  return { id: randomUUID(), babyId, ...fields, createdAt: new Date().toISOString() };
}
export function appendRecipe(plan: PlanEnvelope, recipe: LegacyRecipe): Record<string, unknown> {
  const history = readRecipeHistory(plan);
  // Leave supplement/vaccine/other state intact; only the recipe namespace changes.
  return { ...plan.planData, webRecipes: [...history, recipe] };
}
export function listRecipes(plan: PlanEnvelope, query: URLSearchParams): LegacyRecipe[] {
  const date = query.get("date");
  if (date && !isValidDateStr(date)) invalid("Invalid date format, expected YYYY-MM-DD", 400);
  const limit = Math.min(100, Math.max(1, parseInt(query.get("limit") || "50", 10) || 50));
  return readRecipeHistory(plan).filter(recipe => !date || recipe.date === date)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

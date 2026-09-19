import {
  BridgeError,
  pathId,
  requireData,
  type BridgeFetch,
} from "./bridge-protocol";
import {
  extractSupplementStateFromFoodPlan,
  type SupplementState,
} from "./nutrition-compat";
import {
  fromGrowDeskFeedingRecord,
  type GrowDeskFeedingRecord,
  type LegacyFeedingRecord,
} from "./feeding-compat";

/**
 * The legacy feeding endpoints embedded this full object in every row. Keep
 * this type local to the compatibility boundary: the canonical product
 * contract deliberately uses decimal strings and JSON values.
 */
export interface LegacyFeedingFormulaProduct {
  id: string;
  familyId: string;
  name: string;
  brand: string;
  stage: number | string | null;
  scoopWeightG: number | null;
  waterPerScoopMl: number | null;
  reconstitutionRatio: number | null;
  servingSizeUnit: string;
  nutrientsJson: string | null;
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LegacyFeedingRecordWithFormulaProduct = LegacyFeedingRecord & {
  formulaProduct: LegacyFeedingFormulaProduct | null;
};

/** Fields returned by the canonical formula-product list endpoint. */
export interface GrowDeskFeedingFormulaProduct {
  id: string;
  familyId: string;
  name: string;
  brand: string;
  stage: string | null;
  scoopGrams: string | null;
  waterMlPerScoop: string | null;
  reconstitutionRatio: string | null;
    servingSizeUnit: string;
  nutrientsJson: unknown | null;
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormulaProductPage {
  data: unknown;
  page: { nextCursor: string | null };
}

function invalid(message: string): never {
  throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", message);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`GrowDesk 返回了无效的${label}`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string") invalid(`GrowDesk 返回了无效的${label}`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`GrowDesk 返回了无效的${label}`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`GrowDesk 返回了无效的${label}`);
  return value;
}

function numberValue(value: unknown, label: string, nullable = false): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== "number" && typeof value !== "string") invalid(`GrowDesk 返回了无效的${label}`);
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) invalid(`GrowDesk 返回了无效的${label}`);
  return number;
}

function stageValue(value: unknown): number | string | null {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") invalid("GrowDesk 返回了无效的奶粉阶段");
  const number = Number(value);
  return Number.isFinite(number) ? number : String(value);
}

/**
 * JSONB does not preserve object member order. The legacy wire string does:
 * nutrient values historically serialized as {amount,unit}. Reorder only
 * those existing keys while recursively retaining every other property and
 * the original top-level nutrient order.
 */
function normalizeNutrientJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNutrientJson);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(source, "amount")) out.amount = normalizeNutrientJson(source.amount);
  if (Object.prototype.hasOwnProperty.call(source, "unit")) out.unit = normalizeNutrientJson(source.unit);
  for (const key of Object.keys(source)) {
    if (key === "amount" || key === "unit") continue;
    out[key] = normalizeNutrientJson(source[key]);
  }
  return out;
}

function jsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(normalizeNutrientJson(value));
    return encoded === undefined ? null : encoded;
  } catch {
    invalid("GrowDesk 返回了不可序列化的奶粉营养数据");
  }
}

function customNutrientsFor(state: SupplementState, productId: string): unknown {
  const custom = state.customFormulaNutrients;
  if (!custom || !Object.prototype.hasOwnProperty.call(custom, productId)) return undefined;
  const value = custom[productId];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("GrowDesk 返回了无效的自定义奶粉营养数据");
  }
  return value;
}

/** Convert persisted canonical fields without filling missing metadata from presets. */
export function fromGrowDeskFeedingFormulaProduct(
  rawValue: unknown,
  familyId: string,
  state: SupplementState,
): LegacyFeedingFormulaProduct {
  const raw = objectValue(rawValue, "奶粉档案") as Partial<GrowDeskFeedingFormulaProduct>;
  if (typeof raw.id !== "string" || !raw.id) invalid("GrowDesk 返回了无效的奶粉档案 ID");
  if (raw.familyId !== familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他家庭的奶粉档案");
  }
  if (typeof raw.name !== "string" || !raw.name || typeof raw.brand !== "string" || !raw.brand) {
    invalid("GrowDesk 返回了无效的奶粉档案名称");
  }
  if (raw.isArchived !== undefined && typeof raw.isArchived !== "boolean") invalid("GrowDesk 返回了无效的奶粉归档状态");

  const customNutrients = customNutrientsFor(state, raw.id);
  return {
    id: raw.id,
    familyId,
    name: raw.name,
    brand: raw.brand,
    stage: stageValue(raw.stage),
    scoopWeightG: numberValue(raw.scoopGrams, "单勺克重", true),
    waterPerScoopMl: numberValue(raw.waterMlPerScoop, "每勺加水量", true),
    reconstitutionRatio: numberValue(raw.reconstitutionRatio, "冲调比例", true),
    servingSizeUnit: requiredString(raw.servingSizeUnit, "营养计量单位"),
    nutrientsJson: jsonString(customNutrients === undefined ? raw.nutrientsJson : customNutrients),
    notes: stringValue(raw.notes, "奶粉备注", true),
    isActive: booleanValue(raw.isActive, "奶粉启用状态"),
    isDefault: state.defaultFormulaId !== undefined && state.defaultFormulaId !== null
      ? state.defaultFormulaId === raw.id
      : booleanValue(raw.isDefault, "奶粉默认状态"),
    createdAt: requiredString(raw.createdAt, "奶粉创建时间"),
    updatedAt: requiredString(raw.updatedAt, "奶粉更新时间"),
  };
}

async function listFormulaProducts(
  fetchApi: BridgeFetch,
  token: string,
  familyId: string,
  state: SupplementState,
): Promise<Map<string, LegacyFeedingFormulaProduct>> {
  const result = new Map<string, LegacyFeedingFormulaProduct>();
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const params = new URLSearchParams({ limit: "200", includeArchived: "true" });
    if (cursor !== null) params.set("cursor", cursor);
    const response = await fetchApi<unknown>(
      `/api/v1/families/${pathId(familyId)}/nutrition/products?${params.toString()}`,
      { accessToken: token },
    );
    const data = requireData(response);
    if (!Array.isArray(data) || !response.page || !(response.page.nextCursor === null || typeof response.page.nextCursor === "string")) {
      invalid("GrowDesk 奶粉列表分页响应无效");
    }
    for (const raw of data) {
      const product = fromGrowDeskFeedingFormulaProduct(raw, familyId, state);
      if (result.has(product.id)) throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 奶粉列表包含重复记录");
      result.set(product.id, product);
    }
    cursor = response.page.nextCursor;
    if (cursor === null) return result;
    if (!cursor || seen.has(cursor)) throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 奶粉列表返回了重复游标");
    seen.add(cursor);
  }
  throw new BridgeError(502, "UPSTREAM_SCAN_LIMIT", "奶粉档案读取超出范围，未返回完整数据");
}

async function loadFoodPlanState(fetchApi: BridgeFetch, token: string, babyId: string): Promise<SupplementState> {
  const response = await fetchApi<unknown>(`/api/v1/babies/${pathId(babyId)}/food-plan`, { accessToken: token });
  const plan = requireData(response);
  const record = objectValue(plan, "宝宝饮食计划");
  if (record.babyId !== undefined && record.babyId !== babyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝的饮食计划");
  }
  return extractSupplementStateFromFoodPlan(record.planData);
}

/**
 * Add the legacy embedded formulaProduct object to a list or detail result.
 * The record endpoint already authorizes baby membership and returns its
 * canonical familyId; that server-derived family is the only scope used for
 * the catalog request.
 */
export async function enrichGrowDeskFeedingRecords(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  records: GrowDeskFeedingRecord[],
): Promise<LegacyFeedingRecordWithFormulaProduct[]> {
  const legacy = records.map((record) => {
    if (record.babyId !== babyId) {
      throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝的喂养记录");
    }
    return fromGrowDeskFeedingRecord(record);
  });
  const formulaIds = new Set(records.map((record) => record.formulaProductId).filter((id): id is string => Boolean(id)));
  if (formulaIds.size === 0) return legacy.map((record) => ({ ...record, formulaProduct: null }));

  const familyIds = new Set(records.map((record) => record.familyId));
  if (familyIds.size !== 1 || !records[0]?.familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 喂养记录包含多个家庭");
  }
  const familyId = records[0].familyId;
  const state = await loadFoodPlanState(fetchApi, token, babyId);
  const products = await listFormulaProducts(fetchApi, token, familyId, state);

  return records.map((record, index) => {
    const formulaProduct = record.formulaProductId ? products.get(record.formulaProductId) : null;
    if (record.formulaProductId && !formulaProduct) {
      throw new BridgeError(502, "UPSTREAM_RELATION_MISSING", "GrowDesk 喂养记录引用的奶粉档案不存在");
    }
    return { ...legacy[index]!, formulaProduct: formulaProduct ?? null };
  });
}

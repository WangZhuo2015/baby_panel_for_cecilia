if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

import type {
  FormulaProduct,
  SupplementProduct,
  SupplementSchedule,
  SupplementRecord,
  NutrientsMap,
} from "@/types/nutrition";
import { PRESET_FORMULA_PRODUCTS, PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import { getLocalDateStr, formatIsoToLocalTime, localTimeToUtcIso, isValidDateStr } from "@/lib/date";

export interface GrowDeskFormulaProduct {
  id: string;
  familyId: string;
  brand: string;
  name: string;
  stage: string | null;
  scoopGrams: string | null;
  waterMlPerScoop: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GrowDeskSupplementRecord {
  id: string;
  babyId: string;
  familyId: string;
  supplementName: string;
  occurredAt: string;
  amount: string | null;
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplementState {
  supplementProducts: SupplementProduct[];
  supplementSchedules: SupplementSchedule[];
  defaultFormulaId?: string | null;
  customFormulaNutrients?: Record<string, NutrientsMap>;
}

// ─── Nutrients Normalization ────────────────────────────────────────────────

export function normalizeNutrients(raw: unknown): NutrientsMap {
  if (!raw || typeof raw !== "object") return {};
  const standardUnits: Record<string, string> = {
    vitamin_d: "IU",
    vitamind: "IU",
    vitamin_a: "mcg RAE",
    vitamina: "mcg RAE",
    vitamin_c: "mg",
    vitaminc: "mg",
    calcium: "mg",
    iron: "mg",
    zinc: "mg",
    dha: "mg",
    energy_kcal: "kcal",
    protein: "g",
  };
  const standardKeys: Record<string, string> = {
    vitamind: "vitamin_d",
    vitamina: "vitamin_a",
    vitaminc: "vitamin_c",
  };

  const result: NutrientsMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    const cleanKey = k.toLowerCase().replace(/-/g, "_");
    const stdKey = standardKeys[cleanKey] || cleanKey;
    if (typeof v === "number") {
      result[stdKey] = {
        amount: Number(v.toFixed(2)),
        unit: standardUnits[stdKey] || "mg",
      };
    } else if (v && typeof v === "object" && typeof v.amount === "number") {
      result[stdKey] = {
        amount: Number(v.amount.toFixed(2)),
        unit: String(v.unit || standardUnits[stdKey] || "mg"),
      };
    }
  }
  return result;
}

// ─── Amount & Dose Parsing ───────────────────────────────────────────────────

export function formatSupplementAmount(dose: number, unitName?: string | null): string {
  const safeDose = Number.isFinite(dose) && dose > 0 ? dose : 1.0;
  const unit = unitName ? unitName.trim() : "剂";
  // If unit is already empty or generic, return formatted string
  return `${safeDose} ${unit}`.trim();
}

export function parseSupplementAmount(amount: string | null | undefined): { dose: number; unitName: string } {
  if (!amount || typeof amount !== "string" || !amount.trim()) {
    return { dose: 1.0, unitName: "滴" };
  }

  const trimmed = amount.trim();
  // Match number (integer or float) followed by optional whitespace and unit name
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
  if (match && match[1]) {
    const parsedDose = parseFloat(match[1]);
    const parsedUnit = match[2] ? match[2].trim() : "滴";
    return {
      dose: Number.isFinite(parsedDose) && parsedDose > 0 ? parsedDose : 1.0,
      unitName: parsedUnit || "滴",
    };
  }

  return { dose: 1.0, unitName: trimmed };
}

// ─── Notes Tag for Product ID ────────────────────────────────────────────────

export function extractProductIdFromNotes(notes: string | null | undefined): {
  productId: string | null;
  cleanNotes: string | null;
} {
  if (!notes || typeof notes !== "string") {
    return { productId: null, cleanNotes: null };
  }

  const match = notes.match(/^\[productId:([^\]]+)\]\s*(.*)$/s);
  if (match && match[1]) {
    const cleanNotes = match[2] ? match[2].trim() : null;
    return {
      productId: match[1].trim(),
      cleanNotes: cleanNotes && cleanNotes.length > 0 ? cleanNotes : null,
    };
  }

  return { productId: null, cleanNotes: notes.trim() || null };
}

export function encodeProductIdInNotes(productId: string | null | undefined, notes: string | null | undefined): string | null {
  const clean = notes ? notes.trim() : "";
  if (!productId || typeof productId !== "string") {
    return clean.length > 0 ? clean : null;
  }
  const tag = `[productId:${productId.trim()}]`;
  if (clean.length > 0) {
    return `${tag} ${clean}`;
  }
  return tag;
}

// ─── Formula Mapping ─────────────────────────────────────────────────────────

export function findMatchingFormulaPreset(brand: string, name: string) {
  const normName = name.toLowerCase().trim();
  const normBrand = brand.toLowerCase().trim();

  return PRESET_FORMULA_PRODUCTS.find((p) => {
    const pName = p.name.toLowerCase().trim();
    const pBrand = p.brand.toLowerCase().trim();
    return (
      pName === normName ||
      (pBrand === normBrand && pName.includes(normName)) ||
      (normName.includes(pName) && pBrand.includes(normBrand))
    );
  });
}

export function fromGrowDeskFormulaProduct(
  raw: GrowDeskFormulaProduct,
  options?: {
    defaultFormulaId?: string | null;
    customNutrients?: NutrientsMap;
    isFirstActive?: boolean;
  }
): FormulaProduct {
  const preset = findMatchingFormulaPreset(raw.brand, raw.name);

  const scoopWeightG = raw.scoopGrams ? Number(raw.scoopGrams) : preset?.scoopWeightG ?? 4.3;
  const waterPerScoopMl = raw.waterMlPerScoop ? Number(raw.waterMlPerScoop) : preset?.waterPerScoopMl ?? 30.0;
  const reconstitutionRatio =
    waterPerScoopMl > 0 ? Number((scoopWeightG / waterPerScoopMl).toFixed(4)) : preset?.reconstitutionRatio ?? 0.135;

  const nutrients: NutrientsMap =
    options?.customNutrients && Object.keys(options.customNutrients).length > 0
      ? options.customNutrients
      : (preset?.nutrients as NutrientsMap) || {};

  const stage = raw.stage ? parseInt(raw.stage, 10) || null : preset?.stage ?? null;

  const isDefault = options?.defaultFormulaId
    ? options.defaultFormulaId === raw.id
    : Boolean(options?.isFirstActive && !raw.isArchived);

  return {
    id: raw.id,
    familyId: raw.familyId,
    brand: raw.brand,
    name: raw.name,
    stage,
    scoopWeightG: Number.isFinite(scoopWeightG) && scoopWeightG > 0 ? scoopWeightG : 4.3,
    waterPerScoopMl: Number.isFinite(waterPerScoopMl) && waterPerScoopMl > 0 ? waterPerScoopMl : 30.0,
    reconstitutionRatio: Number.isFinite(reconstitutionRatio) && reconstitutionRatio > 0 ? reconstitutionRatio : 0.135,
    servingSizeUnit: preset?.servingSizeUnit || "per_100g",
    nutrients,
    notes: preset?.notes || null,
    isActive: !raw.isArchived,
    isDefault,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function toGrowDeskFormulaCreatePayload(body: Record<string, unknown>) {
  const name = String(body.name || "").trim();
  const brand = String(body.brand || body.name || "").trim();
  if (!name) {
    throw new Error("奶粉名称必填");
  }

  const scoopWeightG = body.scoopWeightG !== undefined ? Number(body.scoopWeightG) : 4.3;
  if (Number.isNaN(scoopWeightG) || scoopWeightG <= 0) {
    throw new Error("单勺克重必须为大于 0 的有效数值");
  }

  const waterPerScoopMl = body.waterPerScoopMl !== undefined ? Number(body.waterPerScoopMl) : 30.0;
  if (Number.isNaN(waterPerScoopMl) || waterPerScoopMl <= 0) {
    throw new Error("每勺加水量必须为大于 0 的有效数值");
  }

  const payload: Record<string, unknown> = {
    brand,
    name,
    scoopGrams: scoopWeightG.toString(),
    waterMlPerScoop: waterPerScoopMl.toString(),
  };

  if (body.stage !== undefined && body.stage !== null) {
    payload.stage = String(body.stage);
  }

  return payload;
}

export function toGrowDeskFormulaUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};

  if (body.brand !== undefined) {
    payload.brand = String(body.brand).trim();
  }
  if (body.name !== undefined) {
    payload.name = String(body.name).trim();
  }
  if (body.stage !== undefined) {
    payload.stage = body.stage !== null ? String(body.stage) : null;
  }
  if (body.scoopWeightG !== undefined) {
    const val = Number(body.scoopWeightG);
    if (Number.isNaN(val) || val <= 0) {
      throw new Error("单勺克重必须为大于 0 的有效数值");
    }
    payload.scoopGrams = val.toString();
  }
  if (body.waterPerScoopMl !== undefined) {
    const val = Number(body.waterPerScoopMl);
    if (Number.isNaN(val) || val <= 0) {
      throw new Error("每勺加水量必须为大于 0 的有效数值");
    }
    payload.waterMlPerScoop = val.toString();
  }
  if (body.isActive !== undefined) {
    payload.isArchived = !body.isActive;
  }

  return payload;
}

// ─── Supplement Record Mapping ───────────────────────────────────────────────

export function findMatchingSupplementProduct(
  supplementName: string,
  taggedProductId: string | null,
  allProducts: SupplementProduct[]
): SupplementProduct | undefined {
  if (taggedProductId) {
    const byId = allProducts.find((p) => p.id === taggedProductId);
    if (byId) return byId;
    const presetById = PRESET_SUPPLEMENT_PRODUCTS.find((p) => (p as any).id === taggedProductId);
    if (presetById) return { ...presetById, id: taggedProductId, familyId: "" } as SupplementProduct;
  }

  const norm = supplementName.toLowerCase().trim();
  const byName = allProducts.find((p) => p.name.toLowerCase().trim() === norm);
  if (byName) return byName;

  const presetByName = PRESET_SUPPLEMENT_PRODUCTS.find((p) => p.name.toLowerCase().trim() === norm);
  if (presetByName) {
    return { ...presetByName, id: taggedProductId || norm, familyId: "" } as SupplementProduct;
  }

  return undefined;
}

export function fromGrowDeskSupplementRecordEnriched(
  raw: GrowDeskSupplementRecord,
  allProducts: SupplementProduct[] = []
): SupplementRecord {
  const { productId: taggedId, cleanNotes } = extractProductIdFromNotes(raw.notes);
  const matchedProduct = findMatchingSupplementProduct(raw.supplementName, taggedId, allProducts);

  const { dose, unitName } = parseSupplementAmount(raw.amount);

  const d = new Date(raw.occurredAt);
  const date = !Number.isNaN(d.getTime()) ? getLocalDateStr(d) : raw.occurredAt.slice(0, 10);
  const time = !Number.isNaN(d.getTime()) ? formatIsoToLocalTime(raw.occurredAt) : "12:00";

  const resolvedProductId = taggedId || matchedProduct?.id || raw.id;

  const fallbackProduct: SupplementProduct = matchedProduct || {
    id: resolvedProductId,
    familyId: raw.familyId,
    name: raw.supplementName,
    brand: raw.supplementName,
    dosageForm: "drops",
    unitName,
    defaultDose: dose,
    nutrients: {},
    notes: cleanNotes,
    isActive: true,
  };

  return {
    id: raw.id,
    babyId: raw.babyId,
    productId: resolvedProductId,
    product: fallbackProduct,
    date,
    time,
    dose,
    unitName: unitName || fallbackProduct.unitName,
    notes: cleanNotes,
    createdAt: raw.createdAt,
  };
}

// ─── Supplement State in Baby Food Plan ──────────────────────────────────────

export function extractSupplementStateFromFoodPlan(planData: unknown): SupplementState {
  if (!planData || typeof planData !== "object") {
    return {
      supplementProducts: [],
      supplementSchedules: [],
      defaultFormulaId: null,
      customFormulaNutrients: {},
    };
  }

  const record = planData as Record<string, any>;
  const suppState = record.supplementState || {};

  return {
    supplementProducts: Array.isArray(suppState.supplementProducts) ? suppState.supplementProducts : [],
    supplementSchedules: Array.isArray(suppState.supplementSchedules) ? suppState.supplementSchedules : [],
    defaultFormulaId: suppState.defaultFormulaId || null,
    customFormulaNutrients: suppState.customFormulaNutrients || {},
  };
}

export function mergeSupplementStateIntoFoodPlan(
  existingPlanData: Record<string, unknown> | null | undefined,
  patch: Partial<SupplementState>
): Record<string, unknown> {
  const base = existingPlanData && typeof existingPlanData === "object" ? { ...existingPlanData } : {};
  const currentState = extractSupplementStateFromFoodPlan(base);

  const newState: SupplementState = {
    supplementProducts: patch.supplementProducts ?? currentState.supplementProducts,
    supplementSchedules: patch.supplementSchedules ?? currentState.supplementSchedules,
    defaultFormulaId: patch.defaultFormulaId !== undefined ? patch.defaultFormulaId : currentState.defaultFormulaId,
    customFormulaNutrients: patch.customFormulaNutrients ?? currentState.customFormulaNutrients,
  };

  return {
    ...base,
    supplementState: newState,
  };
}

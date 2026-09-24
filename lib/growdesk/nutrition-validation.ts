import { BridgeError, pathId } from "./bridge-protocol";

/** Missing values may have a form default; explicit zero/NaN/booleans never do. */
export function positiveDose(value: unknown, label = "dose"): number {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) {
    throw new BridgeError(400, "INVALID_DOSE", `${label} 必须为大于 0 的有效数值`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new BridgeError(400, "INVALID_DOSE", `${label} 必须为大于 0 的有效数值`);
  }
  return number;
}

export function checkedProduct<T extends { id: string; familyId: string }>(value: T, familyId: string, expectedId?: string): T {
  if (!value || typeof value !== "object" || value.familyId !== familyId || (expectedId !== undefined && value.id !== expectedId)) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他家庭的营养产品");
  }
  try { pathId(value.id); } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效的产品标识");
  }
  return value;
}

export function checkedProducts<T extends { id: string; familyId: string }>(values: T[], familyId: string): T[] {
  const seen = new Set<string>();
  return values.map(value => {
    const product = checkedProduct(value, familyId);
    if (seen.has(product.id)) throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了重复的营养产品");
    seen.add(product.id);
    return product;
  });
}

export function assertCatalogDeletion(value: unknown, expectedId: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认删除状态");
  }
  const result = value as Record<string, unknown>;
  if ((result.id !== undefined && result.id !== expectedId) ||
      (result.deleted !== true && result.success !== true)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "服务端未确认删除状态");
  }
}

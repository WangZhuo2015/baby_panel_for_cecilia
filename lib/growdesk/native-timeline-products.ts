import { BridgeError, type BridgeFetch, pathId } from "./bridge-protocol";
import { fetchCompleteList } from "./paged-list";

/** Include archived products because historical records must retain their identity. */
export async function fetchNativeTimelineSupplementProducts(
  fetchApi: BridgeFetch,
  accessToken: string,
  familyId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const products = await fetchCompleteList<unknown>(fetchApi, accessToken,
    `/api/v1/families/${pathId(familyId)}/nutrition/supplement-products?includeArchived=true`);
  const result = new Map<string, Record<string, unknown>>();
  for (const value of products) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidProduct();
    const product = value as Record<string, unknown>;
    if (typeof product.id !== "string" || product.familyId !== familyId || typeof product.name !== "string" || !product.name.trim()) {
      throw invalidProduct();
    }
    try { pathId(product.id); } catch { throw invalidProduct(); }
    if (result.has(product.id)) throw invalidProduct();
    // Do not infer a product from its name or replace a historical dose with the
    // product's current default. Preserve canonical IDs and fields unchanged.
    result.set(product.id, { ...product });
  }
  return result;
}

function invalidProduct(): BridgeError {
  return new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效或跨家庭的补剂档案");
}

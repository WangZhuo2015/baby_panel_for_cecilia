import { BridgeError, pathId, type BridgeFetch } from "./bridge-protocol";
import { accessibleFamily, loadFamilyBabies, loadWebBaby, loadWebIdentity } from "./bridge-identity";

export interface NutritionScope { familyId: string | null; babyId: string | null }

function selection(query: URLSearchParams, body: Record<string, unknown>, key: "babyId" | "familyId"): string | undefined {
  const values = query.getAll(key);
  if (values.length > 1) throw new BridgeError(400, "AMBIGUOUS_SCOPE", `${key} 不可重复`);
  const fromQuery = values[0];
  const fromBody = body[key];
  if (fromQuery !== undefined) pathId(fromQuery);
  if (fromBody !== undefined && fromBody !== null) pathId(fromBody);
  if (fromQuery !== undefined && fromBody !== undefined && fromBody !== null && fromQuery !== fromBody) {
    throw new BridgeError(400, "SCOPE_MISMATCH", "请求正文与 URL 的家庭/宝宝选择不一致");
  }
  return fromQuery ?? (typeof fromBody === "string" ? fromBody : undefined);
}

/** A family-scoped catalog must never silently choose the first other family.
 * Old single-family clients remain supported; ambiguity requires an explicit choice. */
export async function resolveNutritionScope(
  fetchApi: BridgeFetch,
  token: string,
  url: string,
  body: Record<string, unknown> = {},
): Promise<NutritionScope> {
  const query = new URL(url).searchParams;
  const babyId = selection(query, body, "babyId");
  const familyId = selection(query, body, "familyId");
  if (babyId) {
    const baby = await loadWebBaby(fetchApi, token, babyId);
    if (!baby || baby.id !== babyId || !baby.familyId) {
      throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "宝宝资料与请求不一致");
    }
    pathId(baby.familyId);
    if (familyId && familyId !== baby.familyId) {
      throw new BridgeError(403, "BABY_SCOPE_MISMATCH", "宝宝不属于所选家庭");
    }
    return { babyId, familyId: baby.familyId };
  }
  if (familyId) {
    const family = await accessibleFamily(fetchApi, token, familyId);
    const babies = await loadFamilyBabies(fetchApi, token, family);
    if (babies.length > 1) throw new BridgeError(409, "BABY_SELECTION_REQUIRED", "请明确选择宝宝");
    return { familyId, babyId: babies[0]?.id ?? null };
  }
  const identity = await loadWebIdentity(fetchApi, token);
  if (identity.families.length > 1) {
    throw new BridgeError(409, "FAMILY_SELECTION_REQUIRED", "请明确选择家庭与宝宝");
  }
  if (identity.babies.length > 1) throw new BridgeError(409, "BABY_SELECTION_REQUIRED", "请明确选择宝宝");
  return { familyId: identity.family?.id ?? null, babyId: identity.baby?.id ?? null };
}

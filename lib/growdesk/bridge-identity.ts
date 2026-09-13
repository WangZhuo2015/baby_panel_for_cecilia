import { type ApiBaby, type BridgeFetch, type BridgeResult, BridgeError, requireData, pathId, legacyBaby } from "./bridge-protocol";

export interface ApiFamily {
  id: string; name: string; timeZone: string; createdAt: string; updatedAt: string;
}

async function arrayData<T>(promise: Promise<BridgeResult<T[]>>): Promise<T[]> {
  const data = requireData(await promise);
  if (!Array.isArray(data)) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 列表格式错误");
  return data;
}

/** Every listed baby has already been filtered by the API's BabyMember authorization. */
export async function loadWebIdentity(fetchApi: BridgeFetch, token: string) {
  const families = await arrayData(fetchApi<ApiFamily[]>("/api/v1/families", { accessToken: token }));
  let firstFamily: ApiFamily | null = null;
  for (const family of families) {
    firstFamily ??= family;
    const babies = await arrayData(fetchApi<ApiBaby[]>(`/api/v1/families/${pathId(family.id)}/babies`, { accessToken: token }));
    if (babies[0]) return { family, baby: legacyBaby(babies[0]) };
  }
  return { family: firstFamily, baby: null };
}

/** Resolve the requested baby through an authorized API read, never through legacy SQLite. */
export async function loadWebBaby(fetchApi: BridgeFetch, token: string, requestedId?: unknown) {
  if (requestedId !== undefined && requestedId !== null && requestedId !== "") {
    return legacyBaby(requireData(await fetchApi<ApiBaby>(`/api/v1/babies/${pathId(requestedId)}`, { accessToken: token })));
  }
  return (await loadWebIdentity(fetchApi, token)).baby;
}

/** Only infer a creation family when it is unambiguous. */
export async function creationFamilyId(fetchApi: BridgeFetch, token: string, requestedId?: unknown): Promise<string> {
  const families = await arrayData(fetchApi<ApiFamily[]>("/api/v1/families", { accessToken: token }));
  if (requestedId !== undefined && requestedId !== null && requestedId !== "") {
    pathId(requestedId);
    if (!families.some(f => f.id === requestedId)) throw new BridgeError(403, "FAMILY_ACCESS_DENIED", "无权访问该家庭");
    return String(requestedId);
  }
  if (families.length !== 1) throw new BridgeError(409, "FAMILY_SELECTION_REQUIRED", "请明确选择宝宝所属家庭");
  return families[0]!.id;
}

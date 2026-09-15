import { type ApiBaby, type BridgeFetch, type BridgeResult, BridgeError, requireData, pathId, legacyBaby } from "./bridge-protocol";

export interface ApiFamily {
  id: string;
  name: string;
  timeZone?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApiFamilyMember {
  userId: string;
  familyId: string;
  role: string;
  displayName: string;
  joinedAt: string;
  username?: string;
  relation?: string;
}

export type LegacyBaby = ReturnType<typeof legacyBaby>;

export interface WebFamilyIdentity {
  family: ApiFamily;
  babies: LegacyBaby[];
}

export interface WebIdentity {
  /**
   * These two fields remain the legacy selected-family/selected-baby shape.
   * The collection fields are the complete set authorized for this user.
   */
  family: ApiFamily | null;
  baby: LegacyBaby | null;
  families: WebFamilyIdentity[];
  babies: LegacyBaby[];
}

async function arrayData<T>(promise: Promise<BridgeResult<T[]>>): Promise<T[]> {
  const data = requireData(await promise);
  if (!Array.isArray(data)) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 列表格式错误");
  return data;
}

export async function loadFamilyBabies(fetchApi: BridgeFetch, token: string, family: ApiFamily): Promise<LegacyBaby[]> {
  const babies = await arrayData(fetchApi<ApiBaby[]>(`/api/v1/families/${pathId(family.id)}/babies`, { accessToken: token }));
  return babies.map(legacyBaby);
}

/** Every listed baby has already been filtered by the API's BabyMember authorization. */
export async function loadWebIdentity(fetchApi: BridgeFetch, token: string): Promise<WebIdentity> {
  const apiFamilies = await arrayData(fetchApi<ApiFamily[]>("/api/v1/families", { accessToken: token }));
  const families: WebFamilyIdentity[] = [];
  for (const family of apiFamilies) {
    families.push({ family, babies: await loadFamilyBabies(fetchApi, token, family) });
  }
  const selected = families.find(item => item.babies.length > 0) ?? families[0] ?? null;
  const babies = families.flatMap(item => item.babies);
  return {
    family: selected?.family ?? null,
    baby: selected?.babies[0] ?? null,
    families,
    babies,
  };
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

/** Resolve a family supplied by the UI against the authenticated family list. */
export async function accessibleFamily(fetchApi: BridgeFetch, token: string, requestedId?: unknown): Promise<ApiFamily> {
  const families = await arrayData(fetchApi<ApiFamily[]>("/api/v1/families", { accessToken: token }));
  if (requestedId === undefined || requestedId === null || requestedId === "") {
    if (families.length !== 1) throw new BridgeError(409, "FAMILY_SELECTION_REQUIRED", "请明确选择家庭");
    return families[0]!;
  }
  pathId(requestedId);
  const family = families.find(item => item.id === requestedId);
  if (!family) throw new BridgeError(403, "FAMILY_ACCESS_DENIED", "无权访问该家庭");
  return family;
}

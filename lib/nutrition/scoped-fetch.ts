export interface NutritionIdentity {
  userId: string;
  familyId: string;
  babyId: string;
}

export class NutritionIdentityChangedError extends Error {
  readonly code = "NUTRITION_IDENTITY_CHANGED";
  constructor() { super("家庭或宝宝已切换，请刷新核对原请求结果，不要直接重试写入"); }
}

/** Bind each catalog request to the identity which rendered its action.
 * Neither a late response nor an old click handler may cross an account switch. */
export function createNutritionFetch(
  identity: NutritionIdentity | null,
  current: () => NutritionIdentity | null,
  fetchImpl: typeof fetch = fetch,
  requireSuccess = false,
): (path: string, init?: RequestInit) => Promise<Response> {
  function assertIdentity() {
    const latest = current();
    if (!identity || !latest || latest.userId !== identity.userId ||
        latest.familyId !== identity.familyId || latest.babyId !== identity.babyId) {
      throw new NutritionIdentityChangedError();
    }
  }
  return async (path, init) => {
    assertIdentity();
    // Only relative nutrition endpoints; this helper must never attach scope to
    // a third party, arbitrary origin, protocol-relative path or another API.
    const url = new URL(path, "https://nutrition.invalid");
    if (!path.startsWith("/api/nutrition/") || url.origin !== "https://nutrition.invalid" ||
        !url.pathname.startsWith("/api/nutrition/") || url.hash) {
      throw new Error("Invalid nutrition API path");
    }
    for (const [key, value] of [["babyId", identity!.babyId], ["familyId", identity!.familyId]]) {
      const existing = url.searchParams.getAll(key!);
      if (existing.length > 1 || (existing.length === 1 && existing[0] !== value)) {
        throw new NutritionIdentityChangedError();
      }
      url.searchParams.set(key!, value!);
    }
    const headers = new Headers(init?.headers);
    headers.set("x-growdesk-representation", "extended");
    const response = await fetchImpl(url.pathname + url.search, { ...init, headers });
    assertIdentity();
    // A browser may finish receiving the body after a switch, even if the
    // headers arrived earlier. Recheck at the actual JSON consumption boundary.
    const readJSON = response.json.bind(response);
    response.json = async () => {
      const data: unknown = await readJSON();
      assertIdentity();
      return data;
    };
    if (requireSuccess && !response.ok) {
      const data = await response.json().catch(error => {
        if (error instanceof NutritionIdentityChangedError) throw error;
        return null;
      });
      const message = data && typeof data === "object" && typeof data.error === "string"
        ? data.error : `请求失败 (${response.status})`;
      throw new Error(message);
    }
    return response;
  };
}

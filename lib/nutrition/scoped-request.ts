export interface NutritionClientScope {
  userId: string;
  familyId: string;
  babyId: string;
}
export class NutritionScopeChanged extends Error {
  constructor() { super("账号或宝宝已变更，请重新打开当前操作"); this.name = "NutritionScopeChanged"; }
}
export class NutritionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message); this.name = "NutritionRequestError";
  }
}
const ENDPOINTS = new Set([
  "/api/nutrition/products", "/api/nutrition/schedules", "/api/nutrition/records",
  "/api/nutrition/analysis", "/api/ai/parse-nutrition",
]);
export function sameNutritionScope(a: NutritionClientScope | null, b: NutritionClientScope | null): boolean {
  return Boolean(a && b && a.userId === b.userId && a.familyId === b.familyId && a.babyId === b.babyId);
}

/** Scope is captured per UI instance; it is never replaced with the new active baby. */
export function createScopedNutritionRequest(
  scope: NutritionClientScope | null,
  current: () => NutritionClientScope | null,
  fetchApi: typeof fetch = fetch,
) {
  scope = scope ? Object.freeze({ ...scope }) : null;
  let disposed = false;
  let epoch = 0;
  const pending = new Set<AbortController>();
  function assertCurrent(): void {
    if (disposed || !sameNutritionScope(scope, current())) throw new NutritionScopeChanged();
  }
  async function request(path: string, init: RequestInit = {}, allowStatuses: readonly number[] = []): Promise<Pick<Response, "ok" | "status" | "json">> {
    assertCurrent();
    const startedEpoch = epoch;
    const check = () => { assertCurrent(); if (startedEpoch !== epoch) throw new NutritionScopeChanged(); };
    const identity = scope!;
    const url = new URL(path, "https://nutrition.invalid");
    if (!path.startsWith("/api/") || url.origin !== "https://nutrition.invalid" ||
        !ENDPOINTS.has(url.pathname) || url.hash) throw new Error("Unsupported nutrition endpoint");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    headers.set("x-growdesk-expected-user", identity.userId);
    // Both query-only and JSON/form handlers get the same captured selection.
    for (const field of ["babyId", "familyId"] as const) {
      const values = url.searchParams.getAll(field);
      if (values.some(value => value !== identity[field])) throw new NutritionScopeChanged();
      url.searchParams.set(field, identity[field]);
    }
    let body = init.body;
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      if (body instanceof FormData) {
        for (const field of ["babyId", "familyId"] as const) {
          if (body.getAll(field).some(value => value !== identity[field])) {
            throw new NutritionScopeChanged();
          }
        }
        const form = new FormData();
        body.forEach((value, name) => form.append(name, value));
        form.set("babyId", identity.babyId);
        form.set("familyId", identity.familyId);
        body = form;
        headers.delete("content-type");
      } else {
        if (typeof body !== "string") throw new Error("Nutrition writes require a JSON object");
        const value: unknown = JSON.parse(body);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Nutrition writes require a JSON object");
        const record = value as Record<string, unknown>;
        for (const field of ["babyId", "familyId"] as const) {
          if (record[field] !== undefined && record[field] !== identity[field]) throw new NutritionScopeChanged();
        }
        body = JSON.stringify({ ...record, babyId: identity.babyId, familyId: identity.familyId });
        headers.set("content-type", "application/json");
      }
    }
    const controller = new AbortController();
    pending.add(controller);
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    try {
      const response = await fetchApi(url.pathname + url.search, { ...init, method, headers, body, signal, cache: "no-store", redirect: "error" });
      const data: unknown = await response.json();
      check();
      if ((!response.ok && !allowStatuses.includes(response.status)) ||
          (response.ok && data && typeof data === "object" && "success" in data && data.success === false)) {
        const error = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const details = error.details;
        const partial = details && typeof details === "object" && "partialMutation" in details && details.partialMutation === true;
        const message = typeof error.error === "string" ? error.error : "营养数据请求失败，请重试";
        throw new NutritionRequestError(partial ? `部分内容已保存，请刷新确认，勿重复创建。${message}` : message, response.status, details);
      }
      return {
        ok: response.ok,
        status: response.status,
        async json() { check(); return data; },
      };
    } catch (error) {
      check();
      throw error;
    } finally { pending.delete(controller); }
  }
  return {
    request, assertCurrent,
    activate() { disposed = false; },
    dispose() { disposed = true; epoch += 1; for (const controller of pending) controller.abort(); pending.clear(); },
  };
}

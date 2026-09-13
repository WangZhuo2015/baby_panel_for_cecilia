import { type ApiBaby, type BridgeFetch, BridgeError, bridgeErrorResponse, requireData, pathId, babyPayload, legacyBaby } from "./bridge-protocol";
import { loadWebIdentity, loadWebBaby, creationFamilyId } from "./bridge-identity";

export interface WebSession { accessToken: string; user: { id: string; username: string; displayName: string } }
export interface EndpointDependencies {
  fetchApi: BridgeFetch;
  resolveSession: (request: Request) => Promise<WebSession | null>;
  verifyCsrf: (request: Request) => Response | null;
}
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function createIdentityEndpoints(deps: EndpointDependencies) {
  return {
    async me(request: Request): Promise<Response> {
      try {
        const session = await deps.resolveSession(request);
        if (!session) return json({ user: null, family: null, baby: null, membership: null });
        const identity = await loadWebIdentity(deps.fetchApi, session.accessToken);
        return json({ user: session.user, ...identity, membership: null });
      } catch (error) { return bridgeErrorResponse(error); }
    },
    async baby(request: Request): Promise<Response> {
      try {
        if (!["GET", "POST", "PUT"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
        const csrf = deps.verifyCsrf(request);
        if (csrf) return csrf;
        const session = await deps.resolveSession(request);
        if (!session) throw new BridgeError(401, "UNAUTHORIZED", "会话无效或已过期");
        const accessToken = session.accessToken;
        if (request.method === "GET") {
          return json(await loadWebBaby(deps.fetchApi, accessToken, new URL(request.url).searchParams.get("babyId")));
        }
        const raw: unknown = await request.json().catch(() => null);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BridgeError(400, "INVALID_JSON", "请求正文必须是 JSON 对象");
        const body = raw as Record<string, unknown>;
        if (request.method === "POST") {
          const familyId = await creationFamilyId(deps.fetchApi, accessToken, body.familyId);
          const created = requireData(await deps.fetchApi<ApiBaby>(`/api/v1/families/${pathId(familyId)}/babies`, {
            method: "POST", accessToken, body: babyPayload(body),
          }));
          return json(legacyBaby(created), 201);
        }
        const requestedId = body.babyId ?? body.id;
        pathId(requestedId); // Mutations must never infer the first accessible baby.
        const existing = await loadWebBaby(deps.fetchApi, accessToken, requestedId);
        if (!existing) throw new BridgeError(404, "BABY_NOT_FOUND", "请先创建宝宝资料");
        const patch = { ...body };
        // Do not treat an unchanged legacy avatar as a new upload, or erase its reference.
        if (patch.avatarUrl === existing.avatarUrl) delete patch.avatarUrl;
        const updated = requireData(await deps.fetchApi<ApiBaby>(`/api/v1/babies/${pathId(existing.id)}`, {
          method: "PATCH", accessToken, body: babyPayload(patch, true),
        }));
        return json(legacyBaby(updated));
      } catch (error) { return bridgeErrorResponse(error); }
    },
  };
}

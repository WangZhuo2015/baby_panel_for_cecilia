import { BridgeError, bridgeErrorResponse, requireData } from "./bridge-protocol";
import type { EndpointDependencies } from "./bridge-endpoints";

type Dependencies = Pick<EndpointDependencies, "fetchApi" | "resolveSession">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Match the backend's old-path grammar without filesystem normalization. */
export function legacyAttachmentPath(segments: readonly string[]): string {
  if (!Array.isArray(segments) || !segments.length || segments.some(segment => (
    typeof segment !== "string" || !segment || segment === "." || segment === ".." ||
    /[/%\\?#\u0000-\u001f\u007f]/.test(segment)
  ))) throw new BridgeError(404, "NOT_FOUND", "附件路径无效");
  const path = `/uploads/${segments.join("/")}`;
  if (new TextEncoder().encode(path).length > 1024) {
    throw new BridgeError(404, "NOT_FOUND", "附件路径过长");
  }
  return path;
}

/** Old image URLs remain usable; every read is authorized by the backend. */
export function createLegacyAttachmentEndpoint(deps: Dependencies) {
  return async (request: Request, segments: readonly string[]): Promise<Response> => {
    try {
      const session = await deps.resolveSession(request);
      if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
      const path = legacyAttachmentPath(segments);
      const result = requireData(await deps.fetchApi<{ id: string }>(
        `/api/v1/web/attachments/resolve-legacy?${new URLSearchParams({ path })}`,
        { accessToken: session.accessToken },
      ));
      if (!result || typeof result.id !== "string" || !uuid.test(result.id)) {
        throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "附件映射响应无效");
      }
      // Do not trust an upstream URL or a forwarded host. The canonical route
      // rechecks the live membership when it retrieves the private bytes.
      return new Response(null, { status: 307, headers: {
        location: `/api/attachments/${result.id}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      } });
    } catch (error) { return bridgeErrorResponse(error); }
  };
}

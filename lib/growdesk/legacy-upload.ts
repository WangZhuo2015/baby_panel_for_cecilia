import { BridgeError, requireData, type BridgeFetch } from "./bridge-protocol";

/** Never use an old URL or an authenticated cookie as a filesystem capability. */
export async function resolveLegacyUploadPath(
  fetchApi: BridgeFetch,
  accessToken: string,
  segments: readonly string[],
): Promise<string> {
  if (!accessToken) throw new BridgeError(401, "SESSION_REQUIRED", "请先登录");
  if (!segments.length || segments.some(segment => !segment || segment === "." || segment === ".."
      || /[/\\%?#\u0000-\u001f\u007f]/.test(segment))) {
    throw new BridgeError(400, "INVALID_ATTACHMENT_PATH", "附件路径无效");
  }
  const legacyPath = `/uploads/${segments.join("/")}`;
  if (legacyPath.length > 1024) throw new BridgeError(400, "INVALID_ATTACHMENT_PATH", "附件路径过长");
  const data = requireData(await fetchApi<unknown>(
    `/api/v1/web/attachments/resolve-legacy?path=${encodeURIComponent(legacyPath)}`,
    { accessToken },
  ));
  if (!data || typeof data !== "object" || Array.isArray(data)
      || typeof (data as Record<string, unknown>).id !== "string"
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String((data as Record<string, unknown>).id))) {
    throw new BridgeError(502, "UPSTREAM_INVALID_ATTACHMENT", "附件服务返回了无效标识");
  }
  return `/api/attachments/${(data as { id: string }).id}`;
}

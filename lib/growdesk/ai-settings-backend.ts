/**
 * Optional loopback bridge for persisted LLM settings and Web chat claims.
 * Other methods and ordinary session operations retain the primary runtime.
 */
export function selectAiSettingsBackend(
  pathname: string,
  defaultApiUrl: string,
  options: { method?: string; body?: unknown } = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const sidecar = env.GROWDESK_AI_SETTINGS_API_URL?.trim();
  if (!sidecar) return defaultApiUrl;
  const route = pathname.split("?")[0];
  const method = options.method || "GET";
  const body = options.body;
  const selected = route === "/api/v1/web/ai/preferences" && ["GET", "PUT"].includes(method)
    || method === "POST"
      && /^\/api\/v1\/web\/ai\/sessions\/[A-Za-z0-9_-]+\/messages$/.test(route)
      && body !== null && typeof body === "object" && !Array.isArray(body)
      && "claim" in body && body.claim === true;
  if (!selected) return defaultApiUrl;
  const url = new URL(sidecar);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || !["", "/"].includes(url.pathname)
    || !["127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("GROWDESK_AI_SETTINGS_API_URL must be a plain loopback HTTP(S) origin");
  }
  return url.origin;
}

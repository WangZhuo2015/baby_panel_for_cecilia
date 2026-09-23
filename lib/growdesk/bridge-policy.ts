/** Method-level migration allowlist. Unknown routes must not fall through to legacy JWT/SQLite. */
export type GrowDeskBridgeBackend = "typescript" | "go";

export const BRIDGED_METHODS: Readonly<Record<string, readonly string[]>> = {
  "/api/baby/avatar": ["POST"],
  "/api/medical/upload": ["POST"],
  "/api/weather": ["GET"],
  "/api/books": ["GET"],
  "/api/app-config": ["GET"],
  "/api/development/milestones": ["GET"],
  "/api/development/activities": ["GET"],
  "/api/development/warning-signs": ["GET"],
  "/api/food/feeding-guidelines": ["GET"],
  "/api/auth/login": ["POST"],
  "/api/auth/register": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/me": ["GET"],
  "/api/baby": ["GET", "POST", "PUT"],
  "/api/baby/members": ["GET", "POST", "DELETE"],
  "/api/family/members": ["GET"],
  "/api/family/invite": ["POST"],
  "/api/family/join": ["POST"],
  "/api/family/preview": ["GET"],
  "/api/records/feeding": ["GET", "POST", "PUT", "DELETE"],
  "/api/records/sleep": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "/api/records/diaper": ["GET", "POST", "PUT", "DELETE"],
  "/api/records/daily-summary": ["GET"],
  "/api/food/logs": ["GET", "POST", "PUT", "DELETE"],
  "/api/food/items": ["GET", "POST"],
  "/api/food/plans": ["GET", "POST"],
  "/api/nutrition/records": ["GET", "POST", "DELETE"],
  "/api/nutrition/products": ["GET", "POST", "PUT", "DELETE"],
  "/api/nutrition/schedules": ["GET", "POST", "DELETE"],
  "/api/nutrition/analysis": ["GET"],
  "/api/growth": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "/api/growth/chart": ["GET"],
  "/api/growth/ocr": ["POST"],
  "/api/medical/reports": ["GET", "POST"],
  "/api/medical/ocr": ["POST"],
  "/api/vaccines": ["GET", "POST", "DELETE"],
  "/api/vaccines/selections": ["GET", "PUT"],
  "/api/records/timeline": ["GET"],
  "/api/notifications": ["GET"],
  "/api/push/subscribe": ["POST", "DELETE"],
  "/api/push/vapid-key": ["GET"],
  "/api/agent/voice": ["POST"],
  "/api/agent/voice/logs": ["GET"],
  "/api/ai/sessions": ["GET", "POST"],
  "/api/ai/chat": ["GET", "POST"],
  "/api/ai/chat/cancel": ["POST"],
  "/api/ai/daily-summary": ["GET", "POST"],
  "/api/ai/tips": ["GET"],
  "/api/ai/jobs": ["GET", "POST"],
  "/api/user/tokens": ["GET", "POST"],
};
const GO_PENDING_WEB_ROUTES = new Set([
  "/api/agent/voice",
  "/api/ai/chat",
  "/api/ai/chat/cancel",
  "/api/ai/daily-summary",
  "/api/ai/jobs",
  "/api/ai/tips",
  "/api/growth/ocr",
  "/api/medical/ocr",
  "/api/user/tokens",
]);

function isPendingGoRoute(pathname: string): boolean {
  if (GO_PENDING_WEB_ROUTES.has(pathname)) return true;
  return /^\/api\/ai\/jobs\/[^/]+$/.test(pathname);
}

export function isBridgedMethod(
  pathname: string,
  method: string,
  backend: GrowDeskBridgeBackend = "typescript",
): boolean {
  const upperMethod = method.toUpperCase();

  // The Go preview must never silently fall back to Web-local AI/PAT state.
  if (backend === "go" && isPendingGoRoute(pathname)) return false;

  if (/^\/api\/agent\/voice\/logs\/[a-f0-9-]{36}$/i.test(pathname)) {
    return ["GET", "PATCH"].includes(upperMethod);
  }
  if (/^\/api\/notifications\/[a-f0-9-]{36}$/i.test(pathname)) {
    return ["POST", "PATCH"].includes(upperMethod);
  }
  // Dynamic session-item handlers implement GET/PATCH/DELETE (POST stays 404-ish upstream).
  if (/^\/api\/ai\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname)) {
    return ["GET", "PATCH", "DELETE"].includes(upperMethod);
  }
  if (/^\/api\/ai\/jobs\/[^/]+$/.test(pathname)) {
    return backend === "typescript" && ["GET", "PATCH"].includes(upperMethod);
  }
  if (/^\/api\/books\/[^/]+$/.test(pathname)) return upperMethod === "PATCH";
  if (/^\/api\/medical\/reports\/[a-f0-9-]{36}$/i.test(pathname)) return ["GET", "PUT", "PATCH", "DELETE"].includes(upperMethod);
  if (/^\/api\/attachments\/[a-f0-9-]{36}$/i.test(pathname)) return upperMethod === "GET";
  return BRIDGED_METHODS[pathname]?.includes(upperMethod) ?? false;
}

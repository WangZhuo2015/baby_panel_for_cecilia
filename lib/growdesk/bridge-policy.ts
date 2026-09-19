/** Method-level migration allowlist. Unknown routes must not fall through to legacy JWT/SQLite. */
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
  "/api/push/subscribe": ["POST"],
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
export function isBridgedMethod(pathname: string, method: string): boolean {
  // Dynamic session-item handlers implement GET/PATCH/DELETE (POST stays 404-ish upstream).
  if (/^\/api\/ai\/sessions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname)) {
    return ["GET", "PATCH", "DELETE"].includes(method.toUpperCase());
  }
  if (/^\/api\/books\/[^/]+$/.test(pathname)) return method.toUpperCase() === "PATCH";
  if (/^\/api\/medical\/reports\/[a-f0-9-]{36}$/i.test(pathname)) return ["GET", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  if (/^\/api\/attachments\/[a-f0-9-]{36}$/i.test(pathname)) return method.toUpperCase() === "GET";
  return BRIDGED_METHODS[pathname]?.includes(method.toUpperCase()) ?? false;
}

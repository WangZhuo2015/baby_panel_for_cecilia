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
  "/api/auth/logout": ["POST"],
  "/api/auth/me": ["GET"],
  "/api/baby": ["GET", "POST", "PUT"],
  "/api/records/feeding": ["GET", "POST", "PUT", "DELETE"],
  "/api/records/sleep": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "/api/records/diaper": ["GET", "POST", "PUT", "DELETE"],
  "/api/food/logs": ["GET", "POST", "PUT", "DELETE"],
  "/api/food/items": ["GET", "POST"],
  "/api/food/plans": ["GET", "POST"],
  "/api/nutrition/records": ["GET", "POST", "DELETE"],
  "/api/growth": ["GET", "POST", "DELETE"],
  "/api/growth/chart": ["GET"],
  "/api/medical/reports": ["GET", "POST"],
  "/api/vaccines": ["GET", "POST"],
  "/api/records/timeline": ["GET"],
  "/api/notifications": ["GET"],
  "/api/push/subscribe": ["POST"],
};
export function isBridgedMethod(pathname: string, method: string): boolean {
  if (/^\/api\/books\/[^/]+$/.test(pathname)) return method.toUpperCase() === "PATCH";
  if (/^\/api\/medical\/reports\/[a-f0-9-]{36}$/i.test(pathname)) return ["GET", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  if (/^\/api\/attachments\/[a-f0-9-]{36}$/i.test(pathname)) return method.toUpperCase() === "GET";
  return BRIDGED_METHODS[pathname]?.includes(method.toUpperCase()) ?? false;
}

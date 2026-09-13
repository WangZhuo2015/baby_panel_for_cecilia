/** Method-level migration allowlist. Unknown routes must not fall through to legacy JWT/SQLite. */
export const BRIDGED_METHODS: Readonly<Record<string, readonly string[]>> = {
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
  return BRIDGED_METHODS[pathname]?.includes(method.toUpperCase()) ?? false;
}

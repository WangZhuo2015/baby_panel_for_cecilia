import { getClientIp } from "@/lib/rate-limit";

/**
 * Verify authorization for internal cron endpoints.
 *
 * Security rules:
 * 1. If CRON_SECRET is configured in environment, it MUST strictly be validated
 *    via Bearer token header or ?secret= query parameter.
 * 2. If no CRON_SECRET is configured, only allow loopback requests (systemd timer / localhost curl).
 */
export function verifyCronAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return true;

    const url = new URL(request.url);
    if (url.searchParams.get("secret") === cronSecret) return true;

    return false;
  }

  const ip = getClientIp(request);
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  return isLocal;
}

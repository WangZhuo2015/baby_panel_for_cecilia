if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}
import { NextResponse } from "next/server";
import { config } from "@/lib/config";

/**
 * Validates request Origin/Referer against canonical allowed origins for state-changing operations.
 * Returns a 403 error response if origin verification fails, or null if valid.
 */
export function verifyBffCsrf(
  request: Request,
  options?: { enforceInTest?: boolean },
): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Determine target origin to check
  let checkUrl = origin || referer;
  if (!checkUrl) {
    // In test environment, allow requests if explicitly running in node test runner without enforceInTest
    if (config.isTest && !options?.enforceInTest) {
      return null;
    }
    return NextResponse.json(
      {
        error: "Forbidden: Missing Origin or Referer header on mutating request",
      },
      { status: 403 },
    );
  }

  try {
    const parsed = new URL(checkUrl);
    const expected = process.env.GROWDESK_WEB_ORIGIN ||
      (config.isProduction ? "https://baby.zwang.fun" : new URL(request.url).origin);
    const canonical = new URL(expected);
    if (!["http:", "https:"].includes(parsed.protocol) || canonical.username || canonical.password) {
      return NextResponse.json({ error: "Forbidden: Invalid origin configuration" }, { status: 403 });
    }
    // Compare the complete origin, including scheme and port. Never trust a supplied Host header.
    if (parsed.origin === canonical.origin) return null;

    return NextResponse.json(
      {
        error: `Forbidden: Untrusted request origin '${parsed.origin}'`,
      },
      { status: 403 },
    );
  } catch {
    return NextResponse.json(
      {
        error: "Forbidden: Malformed Origin or Referer header",
      },
      { status: 403 },
    );
  }
}

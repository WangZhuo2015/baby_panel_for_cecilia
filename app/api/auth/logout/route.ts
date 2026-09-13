import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";
import { config, GROWDESK_CONFIG } from "@/lib/config";
import { validateCsrfOrigin } from "@/lib/api-helpers";
import { getBffSessionSecret, logoutBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";

export async function POST(request: Request) {
  const csrfError = GROWDESK_CONFIG.enabled ? verifyBffCsrf(request) : validateCsrfOrigin(request);
  if (csrfError) return csrfError;

  if (GROWDESK_CONFIG.enabled) {
    const sessionSecret = await getBffSessionSecret(request);
    if (sessionSecret) {
      try { await logoutBffSession(sessionSecret); } catch (error) { return bridgeErrorResponse(error); }
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  if (GROWDESK_CONFIG.enabled) {
    response.cookies.set({
      name: GROWDESK_CONFIG.cookieName,
      value: "",
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

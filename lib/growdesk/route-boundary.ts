import { GROWDESK_CONFIG } from "@/lib/config";
import { verifyBffCsrf } from "./csrf";
import { bridgeErrorResponse } from "./bridge-protocol";

/** Preserve transport/auth errors and disable caching of authenticated BFF data. */
export async function growdeskRouteBoundary(request: Request, run: () => Promise<Response>): Promise<Response> {
  if (!GROWDESK_CONFIG.enabled) return run();
  try {
    const denied = verifyBffCsrf(request);
    const response = denied ?? await run();
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

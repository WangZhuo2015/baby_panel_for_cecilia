import { GROWDESK_CONFIG } from "@/lib/config";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { growdeskFetch } from "@/lib/growdesk/client";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { createPassportEndpoints } from "@/lib/growdesk/passport-endpoints";
import { resolveBffSession } from "@/lib/growdesk/session";

const endpoints = createPassportEndpoints({
  isAvailable: () => GROWDESK_CONFIG.enabled && GROWDESK_CONFIG.usesGoBackend,
  resolveSession: resolveBffSession,
  fetchApi: growdeskFetch,
  loadBaby: loadWebBaby,
  verifyCsrf: verifyBffCsrf,
});

export const POST = (request: Request) => endpoints.claim(request);

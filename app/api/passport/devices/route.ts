import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { createPassportEndpoints } from "@/lib/growdesk/passport-endpoints";
import { resolveBffSession } from "@/lib/growdesk/session";

const endpoints = createPassportEndpoints({
  isAvailable: () => GROWDESK_CONFIG.enabled && GROWDESK_CONFIG.usesGoBackend,
  resolveSession: resolveBffSession,
  fetchApi: growdeskFetch,
  verifyCsrf: verifyBffCsrf,
});

export const GET = (request: Request) => endpoints.listDevices(request);

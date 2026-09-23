import { PUSH_CONFIG } from "@/lib/config";
import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { createCompanionEndpoints } from "./companion-endpoints";

export const growdeskCompanionEndpoints = createCompanionEndpoints({
  fetchApi: growdeskFetch,
  resolveSession: resolveBffSession,
  verifyCsrf: request => verifyBffCsrf(request, { enforceInTest: true }),
  publicPushKey: () => PUSH_CONFIG.publicKey,
});

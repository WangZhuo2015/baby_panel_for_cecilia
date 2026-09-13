import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { createIdentityEndpoints } from "./bridge-endpoints";

export const growdeskIdentityEndpoints = createIdentityEndpoints({
  fetchApi: growdeskFetch,
  resolveSession: resolveBffSession,
  verifyCsrf: verifyBffCsrf,
});

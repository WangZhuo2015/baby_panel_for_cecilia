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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return endpoints.revokeDevice(request, id);
}

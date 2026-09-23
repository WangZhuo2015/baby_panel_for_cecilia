import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { resolveBffSession } from "@/lib/growdesk/session";
import { createLegacyAttachmentEndpoint } from "@/lib/growdesk/legacy-attachment-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  if (!GROWDESK_CONFIG.enabled) return new Response(null, { status: 404 });
  return createLegacyAttachmentEndpoint({
    fetchApi: growdeskFetch, resolveSession: resolveBffSession,
  })(request, (await context.params).path);
}

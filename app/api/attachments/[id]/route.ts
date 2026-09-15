import { downloadAttachment } from "@/lib/growdesk/attachment-bridge";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return downloadAttachment(request, (await params).id);
}

import crypto from "node:crypto";
import { growdeskFetch } from "./client";
import { resolveBffSession } from "./session";
import { verifyBffCsrf } from "./csrf";
import { creationFamilyId, loadWebBaby } from "./bridge-identity";
import { BridgeError, requireData, bridgeErrorResponse, pathId } from "./bridge-protocol";
import { validateUploadedImage } from "@/lib/upload";

export async function uploadAttachment(request: Request, purpose: "avatar" | "medical_report") {
  try {
    const csrf = verifyBffCsrf(request); if (csrf) return csrf;
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) throw new BridgeError(400, "INVALID_FILE", "请选择不超过 20 MB 的图片");
    const bytes = Buffer.from(await file.arrayBuffer());
    const checked = validateUploadedImage(file, bytes);
    if (!checked.valid) throw new BridgeError(400, "INVALID_FILE", checked.error || "图片格式不支持");
    const babyId = form.get("babyId");
    const baby = babyId ? await loadWebBaby(growdeskFetch, session.accessToken, babyId) : null;
    if (purpose === "medical_report" && !baby) throw new BridgeError(400, "BABY_REQUIRED", "请选择宝宝后再上传");
    const familyId = baby?.familyId || await creationFamilyId(growdeskFetch, session.accessToken, form.get("familyId") || undefined);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const mimeType = ({ ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic" } as Record<string, string>)[checked.ext || ".jpg"] || file.type;
    const created = requireData(await growdeskFetch<{ id: string; uploadUrl: string }>("/api/v1/attachments", {
      method: "POST", accessToken: session.accessToken,
      body: { purpose, mimeType, byteSize: bytes.length, sha256, ownerScope: { familyId, ...(baby ? { babyId: baby.id } : {}) } },
    }));
    const uploaded = await fetch(created.uploadUrl, { method: "PUT", body: bytes, headers: { "content-type": mimeType }, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!uploaded.ok) throw new BridgeError(502, "UPLOAD_FAILED", "文件上传失败，请重试");
    requireData(await growdeskFetch(`/api/v1/attachments/${pathId(created.id)}/complete`, { method: "POST", accessToken: session.accessToken, body: { byteSize: bytes.length, sha256 } }));
    const url = `/api/attachments/${created.id}`;
    if (purpose === "avatar" && baby) requireData(await growdeskFetch(`/api/v1/babies/${pathId(baby.id)}`, { method: "PATCH", accessToken: session.accessToken, body: { avatarUrl: url } }));
    return Response.json({ success: true, attachmentId: created.id, ...(purpose === "avatar" ? { avatarUrl: url } : { imageUrl: url, filename: file.name }) });
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function downloadAttachment(request: Request, id: string) {
  try {
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const data = requireData(await growdeskFetch<{ downloadUrl: string; mimeType: string }>(`/api/v1/attachments/${pathId(id)}/download-url`, { accessToken: session.accessToken }));
    const response = await fetch(data.downloadUrl, { redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new BridgeError(502, "DOWNLOAD_FAILED", "附件暂时无法读取");
    return new Response(response.body, { headers: { "content-type": data.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (error) { return bridgeErrorResponse(error); }
}

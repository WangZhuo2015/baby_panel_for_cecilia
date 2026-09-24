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
      method: "POST", accessToken: session.accessToken, signal: request.signal,
      body: { purpose, mimeType, byteSize: bytes.length, sha256, ownerScope: { familyId, ...(baby ? { babyId: baby.id } : {}) } },
    }));
    const uploaded = await fetch(created.uploadUrl, {
      method: "PUT", body: bytes, headers: { "content-type": mimeType }, redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    // A PUT response body is not used; release it rather than retaining a connection.
    void uploaded.body?.cancel().catch(() => undefined);
    if (!uploaded.ok) throw new BridgeError(502, "UPLOAD_FAILED", "文件上传失败，请重试");
    requireData(await growdeskFetch(`/api/v1/attachments/${pathId(created.id)}/complete`, {
      method: "POST", accessToken: session.accessToken, signal: request.signal,
      timeoutMs: 30_000, body: { byteSize: bytes.length, sha256 },
    }));
    const url = `/api/attachments/${pathId(created.id)}`;
    if (purpose === "avatar" && baby) requireData(await growdeskFetch(`/api/v1/babies/${pathId(baby.id)}`, {
      method: "PATCH", accessToken: session.accessToken, signal: request.signal, body: { avatarUrl: url },
    }));
    return Response.json({ success: true, attachmentId: created.id, ...(purpose === "avatar" ? { avatarUrl: url } : { imageUrl: url, filename: file.name }) });
  } catch (error) { return bridgeErrorResponse(error); }
}

export async function downloadAttachment(request: Request, id: string) {
  try {
    const session = await resolveBffSession(request);
    if (!session) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
    const upstream = await growdeskFetch(`/api/v1/attachments/${pathId(id)}/content`, {
      accessToken: session.accessToken, responseType: "stream",
      signal: request.signal, timeoutMs: 30_000,
    });
    if (!upstream.ok) {
      throw new BridgeError(upstream.status, upstream.error?.code || "UPSTREAM_ERROR", upstream.error?.message || "附件暂时无法读取", upstream.error?.details);
    }
    if (!upstream.response?.body) throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "附件内容响应为空");
    const headers = new Headers({
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    });
    const contentType = upstream.response.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    // No Content-Length/Encoding: fetch can decompress upstream bytes. The
    // bounded stream also owns cancellation until EOF or browser disconnect.
    return new Response(upstream.response.body, { status: upstream.response.status, headers });
  } catch (error) { return bridgeErrorResponse(error); }
}

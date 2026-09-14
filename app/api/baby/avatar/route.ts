import { GROWDESK_CONFIG } from "@/lib/config";
import { uploadAttachment } from "@/lib/growdesk/attachment-bridge";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { validateUploadedImage } from "@/lib/upload";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (GROWDESK_CONFIG.enabled) return uploadAttachment(request, "avatar");
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`avatar:${user.id || ip}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `上传过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateUploadedImage(file, buffer);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error || "仅支持 JPG、PNG、WebP、HEIC 格式图片" }, { status: 400 });
    }

    const ext = validation.ext || ".jpg";
    const filename = `avatar_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);


    const avatarUrl = `/uploads/avatars/${filename}`;

    const active = await getActiveBaby(user.id);
    if (active.baby) {
      await prisma.baby.update({
        where: { id: active.baby.id },
        data: { avatarUrl },
      });
    }

    return NextResponse.json({ success: true, avatarUrl });
  } catch (error: any) {
    console.error("POST /api/baby/avatar error:", error);
    return NextResponse.json({ error: "头像上传保存失败，请重试" }, { status: 500 });
  }
}

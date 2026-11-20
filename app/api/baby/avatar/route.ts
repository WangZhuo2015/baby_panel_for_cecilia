import { GROWDESK_CONFIG } from "@/lib/config";
import { uploadAttachment } from "@/lib/growdesk/attachment-bridge";
import { NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { createPendingAvatarFilename } from "@/lib/pending-avatar";
import { getUploadsDir, validateUploadedImage } from "@/lib/upload";
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
    const file = formData.get("file");
    const requestedBabyId = formData.get("babyId");
    const requestedFamilyId = formData.get("familyId");

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }
    if ((requestedBabyId !== null && (typeof requestedBabyId !== "string" || !requestedBabyId.trim())) ||
        (requestedFamilyId !== null && (typeof requestedFamilyId !== "string" || !requestedFamilyId.trim())) ||
        (requestedBabyId !== null && requestedFamilyId !== null)) {
      return NextResponse.json({ error: "请指定一个有效的宝宝或家庭" }, { status: 400 });
    }

    let babyId: string | undefined;
    let familyId: string | undefined;
    if (requestedBabyId !== null) {
      const active = await requireBaby(user, requestedBabyId);
      if (active.errorResponse) return active.errorResponse;
      babyId = active.baby.id;
    } else if (requestedFamilyId !== null) {
      const membership = user.memberships.find((item) => item.familyId === requestedFamilyId);
      if (!membership) return NextResponse.json({ error: "无权访问该家庭" }, { status: 403 });
      familyId = membership.familyId;
    } else {
      const babies = user.memberships.flatMap(({ family }) => family.babies);
      if (babies.length > 1 || (babies.length === 0 && user.memberships.length > 1)) {
        return NextResponse.json({ error: "请选择宝宝或所属家庭" }, { status: 409 });
      }
      babyId = babies[0]?.id;
      familyId = user.memberships[0]?.familyId;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateUploadedImage(file, buffer);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error || "仅支持 JPG、PNG、WebP、HEIC 格式图片" }, { status: 400 });
    }

    const ext = validation.ext === ".heif" ? ".heic" : validation.ext || ".jpg";
    const filename = babyId
      ? `avatar_${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`
      : createPendingAvatarFilename(user.id, familyId, ext);
    const uploadDir = getUploadsDir("avatars");

    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);
    const avatarUrl = `/uploads/avatars/${filename}`;

    if (babyId) {
      try {
        const updated = await prisma.baby.updateMany({
          where: { id: babyId, family: { members: { some: { userId: user.id } } } },
          data: { avatarUrl },
        });
        if (!updated.count) {
          await unlink(filePath);
          return NextResponse.json({ error: "宝宝档案已变更，请重新选择" }, { status: 404 });
        }
      } catch (error) {
        await unlink(filePath).catch(() => {});
        throw error;
      }
    }

    return NextResponse.json({ success: true, avatarUrl });
  } catch (error) {
    console.error("POST /api/baby/avatar error:", error);
    return NextResponse.json({ error: "头像上传保存失败，请重试" }, { status: 500 });
  }
}

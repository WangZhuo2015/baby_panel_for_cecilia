import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireAuth } from "@/lib/api-helpers";
import { validateUploadedImage, getUploadsDir } from "@/lib/upload";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`upload:${user.id || ip}`, 15, 60_000);
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
      return NextResponse.json({ error: validation.error || "图片格式不合法" }, { status: 400 });
    }

    const ext = validation.ext || ".jpg";
    const randomHex = crypto.randomBytes(16).toString("hex");
    const filename = `${Date.now()}_${randomHex}${ext}`;
    const uploadDir = getUploadsDir("medical");

    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const cwd = process.cwd();
    if (cwd.endsWith(".next/standalone") || cwd.endsWith(`${path.sep}.next${path.sep}standalone`)) {
      const standaloneUploadDir = path.join(cwd, "public", "uploads", "medical");
      await mkdir(standaloneUploadDir, { recursive: true });
      await writeFile(path.join(standaloneUploadDir, filename), buffer);
    }

    const imageUrl = `/uploads/medical/${filename}`;
    return NextResponse.json({ success: true, imageUrl, filename });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json({ error: "图片保存失败，请重试" }, { status: 500 });
  }
}

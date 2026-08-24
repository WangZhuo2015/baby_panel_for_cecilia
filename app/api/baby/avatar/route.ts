import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "头像图片不能超过 10MB" }, { status: 400 });
    }

    const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
    const rawExt = path.extname(file.name || "").toLowerCase();
    const isMimeImage = file.type ? file.type.toLowerCase().startsWith("image/") : false;
    const isExtImage = ALLOWED_EXTENSIONS.includes(rawExt);

    if (!isMimeImage && !isExtImage) {
      return NextResponse.json({ error: "仅支持图片格式文件（jpg/png/webp）" }, { status: 400 });
    }

    const ext = isExtImage ? rawExt : ".jpg";


    // Save file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `avatar_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
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

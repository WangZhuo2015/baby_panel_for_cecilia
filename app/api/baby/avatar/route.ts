import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "头像图片不能超过 5MB" }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "仅支持 JPG、PNG、WebP 格式的图片" }, { status: 400 });
    }

    // Find the baby
    let targetBaby = null;
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      targetBaby = active?.baby;
    } else {
      targetBaby = await prisma.baby.findFirst();
    }

    if (!targetBaby) {
      return NextResponse.json({ error: "请先创建宝宝信息" }, { status: 404 });
    }

    // Save file
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name).toLowerCase() || ".jpg";
    const filename = `${targetBaby.id}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "avatars");

    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const avatarUrl = `/uploads/avatars/${filename}`;

    // Update database
    const baby = await prisma.baby.update({
      where: { id: targetBaby.id },
      data: { avatarUrl },
    });

    return NextResponse.json(baby);
  } catch (error: any) {
    console.error("POST /api/baby/avatar error:", error);
    return NextResponse.json({ error: "头像上传失败，请重试" }, { status: 500 });
  }
}

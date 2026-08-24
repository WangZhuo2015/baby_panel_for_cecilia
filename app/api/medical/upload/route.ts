import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getAuthSession } from "@/lib/auth";

const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "图片大小不能超过 15MB" }, { status: 400 });
    }

    const rawExt = path.extname(file.name || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(rawExt)) {
      return NextResponse.json(
        { error: "仅支持 JPG、PNG、WebP 格式图片" },
        { status: 400 }
      );
    }

    if (file.type && !file.type.toLowerCase().startsWith("image/")) {
      return NextResponse.json({ error: "仅支持图片格式文件" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const randomHex = crypto.randomBytes(16).toString("hex");
    const filename = `${Date.now()}_${randomHex}${rawExt}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "medical");

    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const imageUrl = `/uploads/medical/${filename}`;
    return NextResponse.json({ success: true, imageUrl, filename });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json({ error: "图片保存失败，请重试" }, { status: 500 });
  }
}

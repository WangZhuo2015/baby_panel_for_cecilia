import { NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "请选择需要上传的照片" }, { status: 400 });
    }

    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "图片大小不能超过 15MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name) || ".jpg";
    const filename = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "medical");
    const filePath = path.join(uploadDir, filename);

    await writeFile(filePath, buffer);

    const imageUrl = `/uploads/medical/${filename}`;
    return NextResponse.json({ success: true, imageUrl, filename });
  } catch (error: any) {
    console.error("Image upload error:", error);
    return NextResponse.json({ error: "图片保存失败，请重试" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getAuthSession } from "@/lib/auth";
import { getUploadsDir, getProjectRoot } from "@/lib/upload";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // 刻意不映射 .svg（可执行脚本，防存储型 XSS）；未知扩展名一律 octet-stream + nosniff
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    // 儿童头像/医学影像属最高敏数据：拒绝匿名访问（能力 URL 模式不可吊销，必须加会话门槛）
    const session = await getAuthSession(request);
    if (!session) {
      return new NextResponse("Unauthorized", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const { path: pathSegments } = await context.params;
    if (!pathSegments || pathSegments.length === 0) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const safePath = path.join(...pathSegments);
    const candidateDirs = [
      getUploadsDir(),
      path.resolve(process.cwd(), "public", "uploads"),
      path.resolve(getProjectRoot(), ".next", "standalone", "public", "uploads"),
    ];

    let targetPath: string | null = null;
    for (const baseDir of candidateDirs) {
      const p = path.resolve(/* turbopackIgnore: true */ baseDir, safePath);
      // Prevent directory traversal attacks
      if (p.startsWith(baseDir + path.sep) && existsSync(/* turbopackIgnore: true */ p)) {
        targetPath = p;
        break;
      }
    }

    if (!targetPath) {
      return new NextResponse("File Not Found", { status: 404 });
    }

    const fileStat = await stat(/* turbopackIgnore: true */ targetPath);
    if (!fileStat.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const fileBuffer = await readFile(/* turbopackIgnore: true */ targetPath);
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    // 注意：刻意不返回 Access-Control-Allow-Origin / Allow-Credentials。
    // 反射请求 Origin + 允许凭证会让任意网站以用户身份 fetch 读取宝宝/医学影像。
    // 站内消费均为同源 <img> / CSS 背景，无需 CORS。
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("GET /uploads error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

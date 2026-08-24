import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await context.params;
    if (!pathSegments || pathSegments.length === 0) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const baseUploadDir = path.resolve(process.cwd(), "public", "uploads");
    const safePath = path.join(...pathSegments);
    const resolvedPath = path.resolve(baseUploadDir, safePath);

    // Prevent directory traversal attacks (verify path is within uploads boundary)
    if (!resolvedPath.startsWith(baseUploadDir + path.sep)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (!existsSync(resolvedPath)) {
      return new NextResponse("File Not Found", { status: 404 });
    }

    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const fileBuffer = await readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

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

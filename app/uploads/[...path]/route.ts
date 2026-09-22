import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { getAuthSession } from "@/lib/auth";
import { getUploadsDir, getProjectRoot } from "@/lib/upload";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { resolveLegacyUploadPath } from "@/lib/growdesk/legacy-upload";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic", ".heif": "image/heif",
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const session = await resolveBffSession(request);
      if (!session) {
        return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
      }
      const { path: segments } = await context.params;
      const target = await resolveLegacyUploadPath(growdeskFetch, session.accessToken, segments ?? []);
      // A relative redirect stays on this origin. The protected attachment
      // endpoint rechecks authorization when fetching the actual bytes.
      // No legacy JWT, public directory or local disk fallback exists here.
      return new NextResponse(null, { status: 307, headers: {
        Location: target, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      } });
    }

    const session = await getAuthSession(request);
    if (!session) {
      return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
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
      const candidate = path.resolve(/* turbopackIgnore: true */ baseDir, safePath);
      if (candidate.startsWith(baseDir + path.sep) && existsSync(/* turbopackIgnore: true */ candidate)) {
        targetPath = candidate;
        break;
      }
    }
    if (!targetPath) return new NextResponse("File Not Found", { status: 404 });
    const fileStat = await stat(/* turbopackIgnore: true */ targetPath);
    if (!fileStat.isFile()) return new NextResponse("Not Found", { status: 404 });
    const fileBuffer = await readFile(/* turbopackIgnore: true */ targetPath);
    const contentType = MIME_TYPES[path.extname(targetPath).toLowerCase()] || "application/octet-stream";
    // Legacy-mode behavior remains separate; do not expose credentialed CORS.
    return new NextResponse(fileBuffer, { status: 200, headers: {
      "Content-Type": contentType, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("GET /uploads error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

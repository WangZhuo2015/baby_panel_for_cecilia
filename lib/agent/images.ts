import fs from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";

const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/i;

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function parseDataImage(raw: unknown): ImageContent | undefined {
  if (typeof raw !== "string" || raw.length > 4_000_000) return undefined;
  const match = raw.match(DATA_URL);
  if (!match) return undefined;
  return { type: "image", data: match[2], mimeType: match[1].toLowerCase() };
}

export async function resolveImageContent(raw: unknown): Promise<ImageContent | undefined> {
  if (!raw || typeof raw !== "string") return undefined;

  // 1. Base64 Data URL
  if (raw.startsWith("data:image/")) {
    return parseDataImage(raw);
  }

  // 2. Local uploads path: e.g. /uploads/medical/xxx.jpg or uploads/medical/xxx.jpg
  if (raw.startsWith("/uploads/") || raw.startsWith("uploads/")) {
    const clean = raw.replace(/^\/+/, "");
    const cwd = process.cwd();
    const candidatePaths = [
      path.resolve(/* turbopackIgnore: true */ cwd, "public", clean),
      path.resolve(/* turbopackIgnore: true */ cwd, clean),
      path.resolve(/* turbopackIgnore: true */ cwd, ".next", "standalone", "public", clean),
      path.resolve(/* turbopackIgnore: true */ cwd, ".next", "standalone", clean),
    ];

    if (cwd.includes(".next/standalone") || cwd.includes(`${path.sep}.next${path.sep}standalone`)) {
      const root = path.resolve(/* turbopackIgnore: true */ cwd, "..", "..");
      candidatePaths.push(path.resolve(/* turbopackIgnore: true */ root, "public", clean));
      candidatePaths.push(path.resolve(/* turbopackIgnore: true */ root, clean));
    }

    for (const p of candidatePaths) {
      try {
        const stats = await fs.stat(/* turbopackIgnore: true */ p);
        if (stats.isFile() && stats.size <= 8 * 1024 * 1024) {
          const buf = await fs.readFile(/* turbopackIgnore: true */ p);
          const ext = path.extname(p).toLowerCase();
          const mimeType = EXT_TO_MIME[ext] || "image/jpeg";
          return {
            type: "image",
            data: buf.toString("base64"),
            mimeType,
          };
        }
      } catch {
        // continue trying other candidate paths
      }
    }
  }

  return undefined;
}


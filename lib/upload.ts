import path from "path";

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"] as const;
export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  ext?: string;
  mime?: string;
}

/**
 * Validates image buffer magic bytes against expected image signatures.
 */
export function validateImageMagicBytes(buffer: Buffer): { valid: boolean; detectedMime?: string } {
  if (!buffer || buffer.length < 12) {
    return { valid: false };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, detectedMime: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { valid: true, detectedMime: "image/png" };
  }

  // WebP: RIFF .... WEBP
  // Offset 0-3: 52 49 46 46 (RIFF), Offset 8-11: 57 45 42 50 (WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { valid: true, detectedMime: "image/webp" };
  }

  // HEIC / HEIF: ftypheic / ftypmif1 / ftypmsf1 / ftypheix
  const ftypStr = buffer.subarray(4, 12).toString("ascii");
  if (ftypStr.startsWith("ftyp") && (ftypStr.includes("heic") || ftypStr.includes("mif1") || ftypStr.includes("msf1") || ftypStr.includes("heix"))) {
    return { valid: true, detectedMime: "image/heic" };
  }

  return { valid: false };
}

/**
 * Validates uploaded image file extension, MIME type, size, and binary magic bytes.
 */
export function validateUploadedImage(
  file: { name?: string; type?: string; size?: number },
  buffer: Buffer,
  maxSizeBytes = MAX_UPLOAD_SIZE_BYTES
): ImageValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: "文件内容为空" };
  }

  const size = file.size ?? buffer.length;
  if (size > maxSizeBytes) {
    const maxMb = Math.round(maxSizeBytes / (1024 * 1024));
    return { valid: false, error: `图片大小不能超过 ${maxMb}MB` };
  }

  const rawExt = path.extname(file.name || "").toLowerCase();
  if (!rawExt || !ALLOWED_IMAGE_EXTENSIONS.includes(rawExt as any)) {
    return { valid: false, error: "不支持的文件格式，仅允许上传 JPG、PNG、WebP 或 HEIC 图片" };
  }

  const mime = (file.type || "").toLowerCase();
  if (mime && !ALLOWED_IMAGE_MIMES.includes(mime as any) && mime !== "application/octet-stream") {
    return { valid: false, error: "不支持的 MIME 类型" };
  }

  const magic = validateImageMagicBytes(buffer);
  if (!magic.valid) {
    return { valid: false, error: "图片文件内容或签名不合法，请提供真实的有效图片" };
  }

  // 交叉校验：真实二进制签名必须与扩展名声明的格式一致，防止改名混淆
  const extFamily: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heic",
  };
  if (magic.detectedMime !== extFamily[rawExt]) {
    return {
      valid: false,
      error: `文件内容与扩展名不符：内容为 ${magic.detectedMime}，扩展名为 ${rawExt}`,
    };
  }

  return {
    valid: true,
    ext: rawExt === ".jpeg" ? ".jpg" : rawExt,
    mime: magic.detectedMime || mime || "image/jpeg",
  };
}

export function getProjectRoot(): string {
  let cwd = process.cwd();
  if (cwd.endsWith(`${path.sep}.next${path.sep}standalone`) || cwd.endsWith(".next/standalone")) {
    cwd = path.resolve(cwd, "..", "..");
  }
  return cwd;
}

export function getUploadsDir(subDir?: string): string {
  const root = getProjectRoot();
  const base = path.resolve(root, "public", "uploads");
  return subDir ? path.resolve(base, subDir) : base;
}


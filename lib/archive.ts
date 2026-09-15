import { prisma } from "@/lib/prisma";
import { isGrowDeskEnabled } from "@/lib/growdesk/config";
import { mkdir, writeFile, chmod } from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * 不可变审计存档（append-only）：
 * - 二进制（图片/音频）落 data/archive/YYYYMM/，写入后 chmod 0444
 * - 文本直接入库 content 字段
 * - 每条记录带 sha256 内容哈希，任何篡改均可被发现
 * 应用层约定：只 insert，永不 update/delete。
 */

const ARCHIVE_ROOT = path.join(process.cwd(), "data", "archive");

function monthDir(): string {
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return path.join(ARCHIVE_ROOT, ym);
}

export async function archiveBuffer(
  kind: "input_image" | "input_audio",
  buf: Buffer,
  ext: string
): Promise<{ id: string; filePath: string; hash: string }> {
  const dir = monthDir();
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
  const filePath = path.join(dir, name);
  await writeFile(filePath, buf);
  // 只读：属主与所有用户均不可写
  await chmod(filePath, 0o444).catch(() => {});
  const hash = crypto.createHash("sha256").update(buf).digest("hex");

  const relPath = path.relative(process.cwd(), filePath);
  if (isGrowDeskEnabled()) {
    return { id: `arch_${hash.slice(0, 16)}`, filePath: relPath, hash };
  }

  const row = await prisma.aiArchive.create({
    data: {
      kind,
      filePath: relPath,
      contentHash: hash,
      byteSize: buf.length,
    },
  });
  return { id: row.id, filePath: relPath, hash };
}

export async function archiveText(
  kind: "input_text" | "output_json" | "output_error",
  content: string
): Promise<string> {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  if (isGrowDeskEnabled()) {
    return `arch_${hash.slice(0, 16)}`;
  }
  const row = await prisma.aiArchive.create({
    data: { kind, content, contentHash: hash, byteSize: Buffer.byteLength(content) },
  });
  return row.id;
}

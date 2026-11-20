import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getJwtSecret } from "@/lib/config";

const PENDING_AVATAR_PATH = "/uploads/avatars/pending_";

function signPendingAvatar(userId: string, familyId: string | undefined, id: string, ext: string): Buffer {
  return createHmac("sha256", getJwtSecret())
    .update(JSON.stringify(["pending-avatar", userId, familyId ?? null, id, ext]))
    .digest();
}

export function createPendingAvatarFilename(userId: string, familyId: string | undefined, ext: string): string {
  const id = randomBytes(16).toString("hex");
  const signature = signPendingAvatar(userId, familyId, id, ext).toString("hex");
  return `pending_${id}_${signature}${ext}`;
}

export function canUsePendingAvatar(url: string, userId: string, familyId?: string): boolean {
  if (!url.startsWith(PENDING_AVATAR_PATH)) return false;
  const match = /^([a-f0-9]{32})_([a-f0-9]{64})(\.(?:jpg|png|webp|heic))$/.exec(url.slice(PENDING_AVATAR_PATH.length));
  if (!match) return false;
  const [, id, signature, ext] = match;
  return timingSafeEqual(Buffer.from(signature, "hex"), signPendingAvatar(userId, familyId, id, ext));
}

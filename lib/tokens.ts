import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const TOKEN_PREFIX = "bp_pat_";

/** SHA-256 哈希（与 lib/oauth/service.ts 的 hashSecret 同算法）：库中永存原文。 */
export function hashPersonalAccessToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** 列表展示用 hint（如 bp_pat_ab12…9f3c），创建时随哈希一并入库。 */
export function buildTokenHint(rawToken: string): string {
  if (rawToken.length <= 14) return `${rawToken.slice(0, 6)}…${rawToken.slice(-4)}`;
  return `${rawToken.slice(0, 10)}…${rawToken.slice(-4)}`;
}

/** 每用户最多持有令牌数（防 token 刷库）。 */
export const MAX_TOKENS_PER_USER = 10;

/**
 * Generates a new Personal Access Token for the specified user.
 * 仅返回一次原文；库中只存哈希。调用方须做限流与数量上限检查。
 */
export async function createPersonalAccessToken(
  userId: string,
  name = "我的快捷指令"
): Promise<{ id: string; name: string; token: string; createdAt: Date }> {
  const randomHex = crypto.randomBytes(24).toString("hex");
  const token = `${TOKEN_PREFIX}${randomHex}`;

  const created = await prisma.personalAccessToken.create({
    data: {
      userId,
      name: name.trim() || "我的快捷指令",
      tokenHash: hashPersonalAccessToken(token),
      tokenHint: buildTokenHint(token),
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  });

  return { ...created, token };
}

/**
 * Verifies a Personal Access Token string and returns the associated user.
 * Automatically updates `lastUsedAt`.
 */
export async function verifyPersonalAccessToken(rawToken: string) {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const record = await prisma.personalAccessToken.findUnique({
    where: { tokenHash: hashPersonalAccessToken(rawToken) },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          memberships: {
            select: { familyId: true, role: true, relation: true },
          },
        },
      },
    },
  });

  if (!record || !record.user) {
    return null;
  }

  // Update lastUsedAt asynchronously without blocking request
  void prisma.personalAccessToken
    .update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      console.warn("[PersonalAccessToken] Failed to update lastUsedAt:", err);
    });

  return {
    user: record.user,
    tokenRecord: {
      id: record.id,
      name: record.name,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
    },
  };
}

/**
 * Lists all Personal Access Tokens belonging to a user (hint only, 无原文).
 */
export async function listPersonalAccessTokens(userId: string) {
  const tokens = await prisma.personalAccessToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenHint: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return tokens.map((t) => ({
    id: t.id,
    name: t.name,
    maskedToken: t.tokenHint || "••••••••",
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
  }));
}

/**
 * Revokes / deletes a Personal Access Token for the user.
 */
export async function revokePersonalAccessToken(userId: string, tokenId: string): Promise<boolean> {
  const target = await prisma.personalAccessToken.findFirst({
    where: { id: tokenId, userId },
  });

  if (!target) return false;

  await prisma.personalAccessToken.delete({
    where: { id: tokenId },
  });

  return true;
}

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { GROWDESK_CONFIG } from "@/lib/config";

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

interface BffPatItem {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenHint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const bffPersonalAccessTokens = new Map<string, BffPatItem>();

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
  const tokenHash = hashPersonalAccessToken(token);
  const tokenHint = buildTokenHint(token);

  if (GROWDESK_CONFIG.enabled) {
    const id = `pat_${crypto.randomUUID()}`;
    const createdAt = new Date();
    bffPersonalAccessTokens.set(id, {
      id,
      userId,
      name: name.trim() || "我的快捷指令",
      tokenHash,
      tokenHint,
      createdAt,
      lastUsedAt: null,
    });
    return { id, name: name.trim() || "我的快捷指令", token, createdAt };
  }

  const created = await prisma.personalAccessToken.create({
    data: {
      userId,
      name: name.trim() || "我的快捷指令",
      tokenHash,
      tokenHint,
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

  const tokenHash = hashPersonalAccessToken(rawToken);

  if (GROWDESK_CONFIG.enabled) {
    let found: BffPatItem | null = null;
    for (const item of bffPersonalAccessTokens.values()) {
      if (item.tokenHash === tokenHash) {
        found = item;
        break;
      }
    }
    if (!found) return null;
    found.lastUsedAt = new Date();
    return {
      user: {
        id: found.userId,
        username: "pat_user",
        displayName: "快捷指令用户",
        memberships: [
          { familyId: "family-1", role: "admin", relation: "caregiver" },
        ],
      },
      tokenRecord: {
        id: found.id,
        name: found.name,
        createdAt: found.createdAt,
        lastUsedAt: found.lastUsedAt,
      },
    };
  }

  const record = await prisma.personalAccessToken.findUnique({
    where: { tokenHash },
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
  if (GROWDESK_CONFIG.enabled) {
    const list: Array<{ id: string; name: string; maskedToken: string; lastUsedAt: Date | null; createdAt: Date }> = [];
    for (const item of bffPersonalAccessTokens.values()) {
      if (item.userId === userId) {
        list.push({
          id: item.id,
          name: item.name,
          maskedToken: item.tokenHint || "••••••••",
          lastUsedAt: item.lastUsedAt,
          createdAt: item.createdAt,
        });
      }
    }
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

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
  if (GROWDESK_CONFIG.enabled) {
    const item = bffPersonalAccessTokens.get(tokenId);
    if (!item || item.userId !== userId) return false;
    bffPersonalAccessTokens.delete(tokenId);
    return true;
  }

  const target = await prisma.personalAccessToken.findFirst({
    where: { id: tokenId, userId },
  });

  if (!target) return false;

  await prisma.personalAccessToken.delete({
    where: { id: tokenId },
  });

  return true;
}

import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const TOKEN_PREFIX = "bp_pat_";

/**
 * Generates a new Personal Access Token for the specified user.
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
      token,
    },
    select: {
      id: true,
      name: true,
      token: true,
      createdAt: true,
    },
  });

  return created;
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
    where: { token: rawToken },
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
 * Lists all Personal Access Tokens belonging to a user (with token masked).
 */
export async function listPersonalAccessTokens(userId: string) {
  const tokens = await prisma.personalAccessToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      token: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return tokens.map((t) => ({
    id: t.id,
    name: t.name,
    maskedToken: `${t.token.slice(0, 10)}••••••••${t.token.slice(-4)}`,
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

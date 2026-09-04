/**
 * API 测试租户隔离 helper（AGENTS.md 合规）：
 * 每个测试文件创建独立的 test_ 前缀用户 + 家庭 + 宝宝，跑完彻底清理。
 * 禁止使用 prisma.user/baby.findFirst() 抓取真实数据。
 */
import { signAuthToken } from "../../lib/auth";
import type { prisma as prismaClient } from "../../lib/prisma";

type Prisma = typeof prismaClient;

export interface TestTenant {
  username: string;
  userId: string;
  babyId: string;
  babyNickname: string;
  familyId: string;
  token: string;
  headers: { Authorization: string; "Content-Type": string };
}

const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PxHqXn5rJQWvFPGf1PVLfZGmOB7a";

export async function createTestTenant(prisma: Prisma, tag: string): Promise<TestTenant> {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const username = `test_${stamp}_${rand}_${tag}_user`;

  const family = await prisma.family.create({
    data: {
      name: `test_family_${stamp}_${tag}`,
      inviteCode: `TT${String(stamp).slice(-4)}${String(rand).slice(-2)}`,
      babies: {
        create: {
          nickname: `test_baby_${stamp}_${tag}`,
          gender: "female",
          birthDate: "2025-06-01",
        },
      },
    },
    include: { babies: true },
  });

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: DUMMY_HASH,
      displayName: `Test ${tag} Parent`,
      memberships: {
        create: { familyId: family.id, role: "admin", relation: "mother" },
      },
    },
  });

  const token = await signAuthToken({ userId: user.id, username: user.username });
  return {
    username,
    userId: user.id,
    babyId: family.babies[0].id,
    babyNickname: family.babies[0].nickname,
    familyId: family.id,
    token,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };
}

/** 删除测试用户（级联 membership/PAT/会话等）+ 残留的空 test_ 家庭。 */
export async function destroyTestTenant(prisma: Prisma, username: string): Promise<void> {
  await prisma.user.deleteMany({ where: { username } }).catch(() => {});
  await prisma.family
    .deleteMany({ where: { name: { startsWith: "test_family_" }, members: { none: {} } } })
    .catch(() => {});
}

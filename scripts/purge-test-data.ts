/**
 * 一键清理测试残留（AGENTS.md）：
 *   npx tsx scripts/purge-test-data.ts
 * 删 test_/e2e_ 用户（级联 membership/PAT/AiJob/会话等）+ 残留的空 test_ 家庭。
 * 局限：AiArchive / OAuthAuditLog 无用户关联，清不掉（审计需要，测试库定期重建即可）。
 */
import { prisma } from "../lib/prisma";

async function main() {
  const users = await prisma.user.deleteMany({
    where: { OR: [{ username: { startsWith: "test_" } }, { username: { startsWith: "e2e_" } }] },
  });
  const families = await prisma.family.deleteMany({
    where: {
      OR: [{ name: { startsWith: "test_" } }, { name: { startsWith: "e2e_" } }],
      members: { none: {} },
    },
  });
  console.log(`purged users=${users.count} orphan_families=${families.count}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

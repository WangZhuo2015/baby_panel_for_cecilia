import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { DATABASE_URL, IS_PRODUCTION, IS_TEST, resolveDatabaseUrl } from "@/lib/config";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isFileUrl(url: string): boolean {
  return url.startsWith("file:");
}

function createPrismaClient(): PrismaClient {
  const resolvedUrl = resolveDatabaseUrl(DATABASE_URL);

  // 🔒 生产数据库硬熔断器：绝对禁止测试环境直连包含真实数据的 dev.db 生产库
  if (IS_TEST && resolvedUrl.includes("dev.db") && !resolvedUrl.includes("dev_test.db")) {
    throw new Error(
      `[FATAL DATABASE SAFETY GUARD] 检测到测试进程试图直连生产数据库: ${resolvedUrl}！\n` +
      `测试必须使用独立测试库 (DATABASE_URL="file:./dev_test.db")，已紧急熔断以保护真实用户数据。`
    );
  }

  const adapter = new PrismaLibSql({ url: resolvedUrl });
  const client = new PrismaClient({ adapter } as any);

  // Configure SQLite for concurrent safety — only for file: URLs (skip for remote libsql://)
  if (isFileUrl(resolvedUrl)) {
    client.$queryRawUnsafe("PRAGMA journal_mode = WAL;").catch((err) => {
      console.warn("Failed to set PRAGMA journal_mode = WAL:", err);
    });
    client.$queryRawUnsafe("PRAGMA busy_timeout = 5000;").catch((err) => {
      console.warn("Failed to set PRAGMA busy_timeout = 5000:", err);
    });
    client.$queryRawUnsafe("PRAGMA foreign_keys = ON;").catch((err) => {
      console.warn("Failed to set PRAGMA foreign_keys = ON:", err);
    });
  }

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!IS_PRODUCTION) globalForPrisma.prisma = prisma;

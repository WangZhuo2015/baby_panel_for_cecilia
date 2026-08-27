import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { DATABASE_URL, IS_PRODUCTION, resolveDatabaseUrl } from "@/lib/config";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function isFileUrl(url: string): boolean {
  return url.startsWith("file:");
}

function createPrismaClient(): PrismaClient {
  const resolvedUrl = resolveDatabaseUrl(DATABASE_URL);
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

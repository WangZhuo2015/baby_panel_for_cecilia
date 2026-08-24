import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { DATABASE_URL, IS_PRODUCTION } from "@/lib/config";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaLibSql({ url: DATABASE_URL });
  const client = new PrismaClient({ adapter } as any);

  // Configure SQLite WAL mode and busy timeout for concurrent safety and query performance
  client.$queryRawUnsafe("PRAGMA journal_mode = WAL;").catch((err) => {
    console.warn("Failed to set PRAGMA journal_mode = WAL:", err);
  });
  client.$queryRawUnsafe("PRAGMA busy_timeout = 5000;").catch((err) => {
    console.warn("Failed to set PRAGMA busy_timeout = 5000:", err);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!IS_PRODUCTION) globalForPrisma.prisma = prisma;

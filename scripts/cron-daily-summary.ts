/**
 * Daily Summary Scheduled Cron CLI Runner
 *
 * Usage:
 *   npx tsx scripts/cron-daily-summary.ts
 *   npx tsx scripts/cron-daily-summary.ts --date=2026-09-05
 *   npx tsx scripts/cron-daily-summary.ts --today-only
 */
import { prisma } from "../lib/prisma";
import { runDailySummaryCron } from "../lib/cron/daily-summary";

async function main() {
  const args = process.argv.slice(2);
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
  const babyIdArg = args.find((a) => a.startsWith("--babyId="))?.split("=")[1];
  const todayOnly = args.includes("--today-only");

  const results = await runDailySummaryCron({
    targetDate: dateArg,
    babyId: babyIdArg,
    todayOnly,
    forceRefresh: true,
  });

  console.log(`[Cron Daily Summary] Completed ${results.length} summary jobs.`);
}

main()
  .catch((err) => {
    console.error("[Cron Daily Summary] Fatal error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });

/**
 * Daily Summary Scheduled Cron Task Core Logic
 */
import { prisma } from "@/lib/prisma";
import { generateAiDailySummary } from "@/lib/ai-daily-summary";
import { getLocalDateStr, addDays, isValidDateStr } from "@/lib/date";
import { isGrowDeskEnabled } from "@/lib/growdesk/config";

export interface CronDailySummaryResult {
  babyId: string;
  babyName: string;
  date: string;
  isAiGenerated: boolean;
  headline: string;
  durationMs: number;
  error?: string;
}

export async function runDailySummaryCron(options?: {
  targetDate?: string;
  todayOnly?: boolean;
  babyId?: string;
  forceRefresh?: boolean;
}): Promise<CronDailySummaryResult[]> {
  if (isGrowDeskEnabled()) {
    console.log("[Cron Daily Summary] GrowDesk mode enabled; cron summary runs via server-side tasks.");
    return [];
  }

  const todayStr = getLocalDateStr();
  const yesterdayStr = addDays(todayStr, -1);

  let targetDates: string[] = [];
  if (options?.targetDate && isValidDateStr(options.targetDate)) {
    targetDates = [options.targetDate];
  } else if (options?.todayOnly) {
    targetDates = [todayStr];
  } else {
    // Generate both today (midday/current progress) and yesterday (finalize full 24h summary)
    targetDates = [todayStr, yesterdayStr];
  }

  // If babyId is explicitly passed (e.g. from test or targeted trigger), query that specific baby.
  // Otherwise, query non-test active babies.
  const babyWhere: any = options?.babyId
    ? { id: options.babyId }
    : { nickname: { not: { startsWith: "test_" } } };

  const babies = await prisma.baby.findMany({
    where: babyWhere,
    include: {
      family: {
        include: {
          members: {
            take: 1,
            select: { userId: true },
          },
        },
      },
    },
  });

  if (babies.length === 0) {
    console.log("[Cron Daily Summary] No active babies found.");
    return [];
  }

  const results: CronDailySummaryResult[] = [];

  for (const baby of babies) {
    const babyName = baby.nickname || "宝宝";
    const userId = baby.family?.members?.[0]?.userId || "system";

    for (const date of targetDates) {
      const startTime = Date.now();
      try {
        console.log(`[Cron Daily Summary] Generating summary for baby "${babyName}" (${baby.id}) on ${date}...`);
        const summary = await generateAiDailySummary(
          { userId, babyId: baby.id, baby },
          date,
          { forceRefresh: options?.forceRefresh ?? true }
        );

        const durationMs = Date.now() - startTime;
        console.log(
          `[Cron Daily Summary] Done in ${durationMs}ms: [${summary.isAiGenerated ? "AI" : "Curated"}] "${summary.headline}"`
        );

        results.push({
          babyId: baby.id,
          babyName,
          date,
          isAiGenerated: summary.isAiGenerated,
          headline: summary.headline,
          durationMs,
        });
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        console.error(`[Cron Daily Summary] Failed for baby "${babyName}" on ${date}:`, err?.message || err);
        results.push({
          babyId: baby.id,
          babyName,
          date,
          isAiGenerated: false,
          headline: "生成失败",
          durationMs,
          error: err?.message || String(err),
        });
      }
    }
  }

  return results;
}

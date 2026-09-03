import { prisma } from "@/lib/prisma";
import type { Baby } from "@/generated/prisma/client";
import {
  getLocalDateStr,
  formatIsoToLocalTime,
  getLocalDayUtcRange,
  addDays,
} from "@/lib/date";

export type VoiceQueryDomain =
  | "feeding"
  | "sleep"
  | "diaper_poop"
  | "diaper"
  | "food"
  | "summary";

export interface FastPathIntent {
  domain: VoiceQueryDomain;
  targetDate: string;
  dateLabel: string;
  isLatestOnly: boolean;
}

export interface VoiceFastPathOptions {
  text: string;
  baby: Baby;
  userId?: string;
}

/**
 * Formats an ISO string or HH:MM string into natural, spoken Chinese time for Siri TTS.
 * e.g. "2026-09-03T06:37:00.000Z" (local 14:37) -> "下午2点37分"
 * "2026-09-03T00:53:00.000Z" (local 08:53) -> "早上8点53分"
 */
export function formatSpokenTime(isoOrHhmm: string): string {
  if (!isoOrHhmm) return "";
  let hhmm = isoOrHhmm;
  if (isoOrHhmm.includes("T") || isoOrHhmm.endsWith("Z")) {
    hhmm = formatIsoToLocalTime(isoOrHhmm);
  }
  if (!hhmm || !hhmm.includes(":")) return "";

  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;

  let period = "上午";
  let hourDisplay = h;
  if (h === 0) {
    period = "凌晨";
    hourDisplay = 12;
  } else if (h < 6) {
    period = "凌晨";
  } else if (h < 9) {
    period = "早上";
  } else if (h < 12) {
    period = "上午";
  } else if (h === 12) {
    period = "中午";
  } else if (h < 18) {
    period = "下午";
    hourDisplay = h > 12 ? h - 12 : h;
  } else {
    period = "晚上";
    hourDisplay = h > 12 ? h - 12 : h;
  }

  const minuteText = m === 0 ? "整" : `${m}分`;
  return `${period}${hourDisplay}点${minuteText}`;
}

/**
 * Formats total duration in minutes to natural spoken Chinese.
 * e.g. 190 -> "3小时10分钟", 60 -> "1小时", 45 -> "45分钟"
 */
export function formatSpokenDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}小时${minutes}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${minutes}分钟`;
}

/**
 * Detects if a spoken voice command is a read query suited for fast-path DB retrieval.
 * Disqualifies any write/record/mutate intent or medical advisory questions.
 */
export function detectVoiceQueryIntent(rawText: string): FastPathIntent | null {
  const text = rawText.trim();
  if (!text) return null;

  // 1. Negative filters: Strictly reject write/bookkeeping and open-ended medical symptoms
  const writeIndicators = [
    /(?:喝|吃|喂)了\s*\d+/i,
    /\d+\s*(?:ml|毫升|分钟|分)/i,
    /(?:刚|刚刚|刚才)?睡着了?$/i,
    /(?:刚|刚刚|刚才)?换了(?!几次|多少)(?:个|张|块|片|新|一)?(?:尿布|纸尿裤)/i,
    /(?:刚|刚刚|刚才)?拉了(?!几次|多少)(?:便便|臭臭|粑粑)/i,
    /(?:记录|记一下|帮我记|打卡|保存|添加|新增)/i,
    /吐奶/i,
    /发烧|拉稀|咳嗽|吃药|疫苗|怎么办|生病|看病|用药/i,
  ];
  for (const indicator of writeIndicators) {
    if (indicator.test(text)) {
      return null;
    }
  }

  // 2. Must contain explicit query or question indicators
  const questionIndicators = [
    /多少/,
    /几/,
    /多久/,
    /多长/,
    /什么时候/,
    /几点/,
    /上次/,
    /最近一次/,
    /情况/,
    /汇总/,
    /总结/,
    /概况/,
    /统计/,
    /查/,
    /看/,
    /了吗/,
    /吗$/,
    /么$/,
    /呢$/,
    /\?$/,
    /？$/,
  ];
  const isQuestionOrQuery = questionIndicators.some((q) => q.test(text));
  if (!isQuestionOrQuery) {
    return null;
  }

  // 3. Resolve target date (default: today)
  const today = getLocalDateStr();
  let targetDate = today;
  let dateLabel = "今天";
  if (/昨天/.test(text)) {
    targetDate = addDays(today, -1);
    dateLabel = "昨天";
  } else if (/前天/.test(text)) {
    targetDate = addDays(today, -2);
    dateLabel = "前天";
  }

  const isLatestOnly =
    /(?:上次|最近一次|上一回|刚|什么时候)/.test(text) &&
    !/(?:今天|昨天|前天|一共|总共)/.test(text);

  // 4. Match domain
  // A. Feeding (奶量 / 喝奶 / 吃奶 / 喂奶 / 配方奶 / 母乳)
  if (
    /(?:奶|喂养|喝奶|吃奶|配方奶|母乳)/.test(text) &&
    /(?:喝|吃|喂|量|多少|几|次|什么时候|上次)/.test(text)
  ) {
    return { domain: "feeding", targetDate, dateLabel, isLatestOnly };
  }

  // B. Sleep (睡眠 / 睡觉 / 睡了多久 / 小睡)
  if (
    /(?:睡|睡眠|入睡|清醒|小睡)/.test(text) &&
    /(?:多久|多长|几小时|几个小时|情况|时间|次|什么时候|上次|醒)/.test(text)
  ) {
    return { domain: "sleep", targetDate, dateLabel, isLatestOnly };
  }

  // C. Diaper: Poop specific (拉便便 / 拉臭臭 / 拉粑粑 / 拉了几次)
  if (
    /(?:拉|便便|臭臭|粑粑)/.test(text) &&
    /(?:几|次|了吗|吗|情况|什么时候|上次)/.test(text)
  ) {
    return { domain: "diaper_poop", targetDate, dateLabel, isLatestOnly };
  }

  // D. Diaper: General / Pee (尿布 / 换尿布 / 嘘嘘 / 尿尿)
  if (
    /(?:尿布|换尿布|嘘嘘|尿尿)/.test(text) &&
    /(?:几|次|了吗|吗|情况|什么时候|上次)/.test(text)
  ) {
    return { domain: "diaper", targetDate, dateLabel, isLatestOnly };
  }

  // E. Food (辅食)
  if (/辅食/.test(text) && /(?:吃|几|什么|情况|了吗|记录)/.test(text)) {
    return { domain: "food", targetDate, dateLabel, isLatestOnly };
  }

  // F. Daily Summary / General (概况 / 总结 / 汇总 / 怎么样 / 情况怎么样 / 带娃情况)
  if (/(?:概况|总结|汇总|怎么样|情况怎么样|带娃情况)/.test(text)) {
    return { domain: "summary", targetDate, dateLabel, isLatestOnly: false };
  }

  return null;
}

/**
 * Fast-path database query and spoken response generator.
 * Returns natural spoken Chinese if handled, or null to fall back to the agent loop.
 */
export async function tryVoiceFastPath(options: VoiceFastPathOptions): Promise<string | null> {
  const intent = detectVoiceQueryIntent(options.text);
  if (!intent) return null;

  const { baby } = options;
  const babyId = baby.id;
  const babyName = baby.nickname || "宝宝";
  const { domain, targetDate, dateLabel, isLatestOnly } = intent;

  try {
    switch (domain) {
      case "feeding": {
        if (isLatestOnly) {
          const latest = await prisma.feedingRecord.findFirst({
            where: { babyId },
            orderBy: { timestamp: "desc" },
          });
          if (!latest) return `${babyName}目前还没有记录喂养数据哦。`;
          const timeText = formatSpokenTime(latest.timestamp);
          if (latest.type === "breast") {
            const mins = (latest.leftMinutes || 0) + (latest.rightMinutes || 0);
            return `${babyName}最近一次喂奶是${timeText}，母乳亲喂${mins ? `了${mins}分钟` : ""}。`;
          }
          if (latest.amountMl) {
            const typeLabel = latest.type === "bottle_breast" ? "瓶喂母乳" : "配方奶";
            return `${babyName}最近一次喂奶是${timeText}，喝了${latest.amountMl}毫升${typeLabel}。`;
          }
          return `${babyName}最近一次喂奶是${timeText}。`;
        }

        const { start, end } = getLocalDayUtcRange(targetDate);
        const records = await prisma.feedingRecord.findMany({
          where: { babyId, timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: "asc" },
        });

        if (records.length === 0) {
          return `${babyName}${dateLabel}还没有记录喝奶数据哦。`;
        }

        let formulaMl = 0;
        let bottleBreastMl = 0;
        let breastCount = 0;
        let breastTotalMinutes = 0;

        for (const r of records) {
          if (r.type === "breast") {
            breastCount++;
            breastTotalMinutes += (r.leftMinutes || 0) + (r.rightMinutes || 0);
          } else if (r.type === "bottle_breast") {
            bottleBreastMl += r.amountMl || 0;
          } else {
            formulaMl += r.amountMl || 0;
          }
        }

        const parts: string[] = [];
        if (formulaMl > 0) {
          parts.push(`喝了${formulaMl}毫升配方奶`);
        }
        if (bottleBreastMl > 0) {
          parts.push(`喝了${bottleBreastMl}毫升瓶喂母乳`);
        }
        if (breastCount > 0) {
          parts.push(
            `母乳亲喂了${breastCount}次${breastTotalMinutes > 0 ? `（共${breastTotalMinutes}分钟）` : ""}`
          );
        }

        const lastRecord = records[records.length - 1];
        const lastTime = formatSpokenTime(lastRecord.timestamp);
        const summaryText = parts.length > 0 ? parts.join("，另外") : "有喂养记录";
        return `${babyName}${dateLabel}一共${summaryText}。最近一次喂奶是${lastTime}。`;
      }

      case "sleep": {
        if (isLatestOnly) {
          const latest = await prisma.sleepRecord.findFirst({
            where: { babyId },
            orderBy: { startTime: "desc" },
          });
          if (!latest) return `${babyName}目前还没有记录睡眠数据哦。`;
          const startStr = formatSpokenTime(latest.startTime);
          const endStr = formatSpokenTime(latest.endTime);
          const durMinutes = Math.max(
            1,
            Math.round(
              (new Date(latest.endTime).getTime() - new Date(latest.startTime).getTime()) / 60000
            )
          );
          return `${babyName}最近一次睡觉是在${startStr}到${endStr}，睡了${formatSpokenDuration(durMinutes)}。`;
        }

        const { start, end } = getLocalDayUtcRange(targetDate);
        const sleepRecords = await prisma.sleepRecord.findMany({
          where: { babyId, startTime: { lt: end }, endTime: { gt: start } },
          orderBy: { startTime: "asc" },
        });

        if (sleepRecords.length === 0) {
          return `${babyName}${dateLabel}还没有记录睡眠数据哦。`;
        }

        const dayStartMs = new Date(start).getTime();
        const dayEndMs = new Date(end).getTime();
        const sleepIntervals = sleepRecords
          .map((r) => ({
            startMs: new Date(r.startTime).getTime(),
            endMs: new Date(r.endTime).getTime(),
          }))
          .filter((iv) => !Number.isNaN(iv.startMs) && !Number.isNaN(iv.endMs) && iv.endMs > iv.startMs)
          .map((iv) => ({
            startMs: Math.max(iv.startMs, dayStartMs),
            endMs: Math.min(iv.endMs, dayEndMs),
          }))
          .filter((iv) => iv.endMs > iv.startMs)
          .sort((a, b) => a.startMs - b.startMs);

        let totalSleepMinutes = 0;
        let mergedStartMs = 0;
        let mergedEndMs = 0;
        for (const interval of sleepIntervals) {
          if (mergedEndMs === 0 || interval.startMs > mergedEndMs) {
            if (mergedEndMs > 0) {
              totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
            }
            mergedStartMs = interval.startMs;
            mergedEndMs = interval.endMs;
          } else {
            mergedEndMs = Math.max(mergedEndMs, interval.endMs);
          }
        }
        if (mergedEndMs > 0) {
          totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
        }

        const lastSleep = sleepRecords[sleepRecords.length - 1];
        const lastWakeTime = formatSpokenTime(lastSleep.endTime);
        return `${babyName}${dateLabel}累计睡眠${formatSpokenDuration(totalSleepMinutes)}，一共小睡了${sleepRecords.length}次。最近一次是${lastWakeTime}醒来的。`;
      }

      case "diaper_poop": {
        if (isLatestOnly) {
          const latest = await prisma.diaperRecord.findFirst({
            where: { babyId, type: { in: ["poop", "both"] } },
            orderBy: { timestamp: "desc" },
          });
          if (!latest) return `${babyName}目前还没有记录便便数据哦。`;
          const time = formatSpokenTime(latest.timestamp);
          return `${babyName}最近一次拉便便是在${time}。`;
        }

        const { start, end } = getLocalDayUtcRange(targetDate);
        const records = await prisma.diaperRecord.findMany({
          where: { babyId, timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: "asc" },
        });

        const poopRecords = records.filter((r) => r.type === "poop" || r.type === "both");
        const peeRecords = records.filter((r) => r.type === "pee" || r.type === "both");

        if (records.length === 0) {
          return `${babyName}${dateLabel}还没有换尿布记录哦。`;
        }

        if (poopRecords.length > 0) {
          const lastPoopTime = formatSpokenTime(poopRecords[poopRecords.length - 1].timestamp);
          return `${babyName}${dateLabel}一共拉了${poopRecords.length}次便便，最近一次是在${lastPoopTime}。另外换了${peeRecords.length}次嘘嘘。`;
        } else {
          return `${babyName}${dateLabel}暂时还没有拉便便，一共换了${peeRecords.length}次嘘嘘尿布。`;
        }
      }

      case "diaper": {
        if (isLatestOnly) {
          const latest = await prisma.diaperRecord.findFirst({
            where: { babyId },
            orderBy: { timestamp: "desc" },
          });
          if (!latest) return `${babyName}目前还没有换尿布记录哦。`;
          const time = formatSpokenTime(latest.timestamp);
          const typeText =
            latest.type === "poop"
              ? "拉便便"
              : latest.type === "both"
                ? "便便和嘘嘘"
                : "嘘嘘";
          return `${babyName}最近一次换尿布是在${time}，是${typeText}。`;
        }

        const { start, end } = getLocalDayUtcRange(targetDate);
        const records = await prisma.diaperRecord.findMany({
          where: { babyId, timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: "asc" },
        });

        if (records.length === 0) {
          return `${babyName}${dateLabel}还没有换尿布记录哦。`;
        }

        const poopCount = records.filter((r) => r.type === "poop" || r.type === "both").length;
        const peeCount = records.filter((r) => r.type === "pee" || r.type === "both").length;
        const lastTime = formatSpokenTime(records[records.length - 1].timestamp);
        return `${babyName}${dateLabel}一共换了${records.length}次尿布，包含${peeCount}次嘘嘘${poopCount > 0 ? `和${poopCount}次便便` : ""}。最近一次换尿布是${lastTime}。`;
      }

      case "food": {
        const foodLogs = await prisma.foodLogRecord.findMany({
          where: { babyId, date: targetDate },
          orderBy: { time: "asc" },
        });

        if (foodLogs.length === 0) {
          return `${babyName}${dateLabel}还没有添加辅食记录哦。`;
        }

        const allFoods: string[] = [];
        for (const log of foodLogs) {
          try {
            const items = JSON.parse(log.foods);
            if (Array.isArray(items)) {
              allFoods.push(...items.filter((x): x is string => typeof x === "string"));
            }
          } catch {}
        }
        const uniqueFoods = Array.from(new Set(allFoods));
        const foodText = uniqueFoods.length > 0 ? `吃了${uniqueFoods.join("、")}` : "";
        const lastFood = foodLogs[foodLogs.length - 1];
        const lastTime = lastFood.time ? formatSpokenTime(lastFood.time) : "";
        return `${babyName}${dateLabel}吃了${foodLogs.length}次辅食${foodText ? `，${foodText}` : ""}${lastTime ? `，最近一次是${lastTime}` : ""}。`;
      }

      case "summary": {
        const { start, end } = getLocalDayUtcRange(targetDate);
        const [feedings, sleeps, diapers, foods] = await Promise.all([
          prisma.feedingRecord.findMany({ where: { babyId, timestamp: { gte: start, lt: end } } }),
          prisma.sleepRecord.findMany({ where: { babyId, startTime: { lt: end }, endTime: { gt: start } } }),
          prisma.diaperRecord.findMany({ where: { babyId, timestamp: { gte: start, lt: end } } }),
          prisma.foodLogRecord.findMany({ where: { babyId, date: targetDate } }),
        ]);

        const totalFeedingMl = feedings.reduce((sum, r) => sum + (r.amountMl ?? 0), 0);
        const poopCount = diapers.filter((d) => d.type === "poop" || d.type === "both").length;

        const dayStartMs = new Date(start).getTime();
        const dayEndMs = new Date(end).getTime();
        const sleepIntervals = sleeps
          .map((r) => ({ startMs: new Date(r.startTime).getTime(), endMs: new Date(r.endTime).getTime() }))
          .filter((iv) => !Number.isNaN(iv.startMs) && !Number.isNaN(iv.endMs) && iv.endMs > iv.startMs)
          .map((iv) => ({ startMs: Math.max(iv.startMs, dayStartMs), endMs: Math.min(iv.endMs, dayEndMs) }))
          .filter((iv) => iv.endMs > iv.startMs)
          .sort((a, b) => a.startMs - b.startMs);

        let totalSleepMinutes = 0;
        let mergedStartMs = 0;
        let mergedEndMs = 0;
        for (const interval of sleepIntervals) {
          if (mergedEndMs === 0 || interval.startMs > mergedEndMs) {
            if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
            mergedStartMs = interval.startMs;
            mergedEndMs = interval.endMs;
          } else {
            mergedEndMs = Math.max(mergedEndMs, interval.endMs);
          }
        }
        if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);

        const parts: string[] = [];
        if (totalFeedingMl > 0) parts.push(`喝奶${totalFeedingMl}毫升`);
        if (totalSleepMinutes > 0) parts.push(`睡眠${formatSpokenDuration(totalSleepMinutes)}`);
        if (diapers.length > 0) parts.push(`换尿布${diapers.length}次${poopCount > 0 ? `（便便${poopCount}次）` : ""}`);
        if (foods.length > 0) parts.push(`吃辅食${foods.length}次`);

        if (parts.length === 0) {
          return `${babyName}${dateLabel}还没有记录作息数据哦。`;
        }
        return `${babyName}${dateLabel}概况：${parts.join("，")}。带娃节奏很不错哦！`;
      }
    }
  } catch (err) {
    console.error("[Voice Fast-Path Error]", err);
    return null;
  }
}

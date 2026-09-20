import { prisma } from "@/lib/prisma";
import {
  getLocalDayUtcRange,
  getLocalDateStr,
  isValidDateStr,
  formatIsoToLocalTime,
} from "@/lib/date";
import { calculateAgeDetail, calculateCorrectedAge } from "@/lib/age";
import { AI_CONFIG } from "@/lib/config";
import { getLlmProfiles, type LlmProfile } from "@/lib/llm-profiles";
import { archiveText } from "@/lib/archive";
import { safeJsonParse } from "@/lib/json";
import { getFeedingEffectiveMl } from "@/lib/nutrition/breastmilk";
import { isGrowDeskEnabled } from "@/lib/growdesk/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { fetchLegacyRecordList, familyDayBounds } from "@/lib/growdesk/record-list";
import { fromGrowDeskFeedingRecord, type GrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { fromGrowDeskSleepRecord, type GrowDeskSleepRecord } from "@/lib/growdesk/sleep-compat";
import { fromGrowDeskDiaperRecord, type GrowDeskDiaperRecord } from "@/lib/growdesk/diaper-compat";
import { fromGrowDeskFoodRecord, type GrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import type {
  DailyComprehensiveMetrics,
  DailyFeedingDetail,
  DailySleepDetail,
  DailyDiaperDetail,
  DailyFoodDetail,
  DailySupplementDetail,
  AiDailySummaryResult,
} from "@/types/daily-summary";

export interface RecordContext {
  userId: string;
  babyId: string;
  baby?: any;
  accessToken?: string;
  familyId?: string;
}

const TYPE_LABELS: Record<string, string> = {
  breast: "母乳亲喂",
  formula: "配方奶",
  bottle_breast: "瓶喂母乳",
  mixed: "混合喂养",
  solid: "辅食餐点",
  pee: "嘘嘘 (尿)",
  poop: "便便",
  both: "嘘嘘 + 便便",
  night: "夜间睡眠",
  day: "白天小睡",
};

const POOP_COLOR_LABELS: Record<string, string> = {
  yellow: "黄色",
  green: "绿色",
  brown: "棕色",
  other: "其他",
};

const POOP_CONSISTENCY_LABELS: Record<string, string> = {
  loose: "稀糊/偏稀",
  paste: "糊状/软便",
  formed: "成形/条状",
};

/**
 * Fetch and calculate complete, rich statistics for a baby on a target calendar date.
 */
export async function fetchDailyComprehensiveMetrics(
  ctx: RecordContext,
  targetDateStr?: string
): Promise<DailyComprehensiveMetrics> {
  const date =
    targetDateStr && isValidDateStr(targetDateStr)
      ? targetDateStr
      : getLocalDateStr();

  const useGrowDesk = isGrowDeskEnabled() || Boolean(ctx.accessToken);
  const token = ctx.accessToken || "";

  let feedingRecords: any[] = [];
  let sleepRecords: any[] = [];
  let diaperRecords: any[] = [];
  let foodLogs: any[] = [];
  let supplementRecords: any[] = [];
  let growthRecords: any = null;
  let medicalReports: number = 0;
  let dayStartMs = 0;
  let dayEndMs = 0;

  if (useGrowDesk) {
    const dateQuery = new URLSearchParams({ date });
    const [feedingRaw, sleepRaw, diaperRaw, foodRaw, bounds] = await Promise.all([
      fetchLegacyRecordList<GrowDeskFeedingRecord>(growdeskFetch, token, ctx.babyId, dateQuery, "feeding").catch(() => []),
      fetchLegacyRecordList<GrowDeskSleepRecord>(growdeskFetch, token, ctx.babyId, dateQuery, "sleep").catch(() => []),
      fetchLegacyRecordList<GrowDeskDiaperRecord>(growdeskFetch, token, ctx.babyId, dateQuery, "diaper").catch(() => []),
      fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, token, ctx.babyId, dateQuery, "food").catch(() => []),
      familyDayBounds(growdeskFetch, token, ctx.babyId, date).catch(() => {
        const { start, end } = getLocalDayUtcRange(date);
        return { start: new Date(start), end: new Date(end) };
      }),
    ]);
    feedingRecords = feedingRaw.map(fromGrowDeskFeedingRecord);
    sleepRecords = sleepRaw.map(fromGrowDeskSleepRecord);
    diaperRecords = diaperRaw.map(fromGrowDeskDiaperRecord);
    foodLogs = foodRaw.map(fromGrowDeskFoodRecord);
    dayStartMs = bounds.start.getTime();
    dayEndMs = bounds.end.getTime();

    // Fetch latest growth measurement in BFF mode
    try {
      const growthRes = await growdeskFetch<any>(
        `/api/v1/babies/${ctx.babyId}/growth-measurements?limit=1`,
        { accessToken: token }
      );
      if (growthRes.ok) {
        const gmList = Array.isArray(growthRes.data)
          ? growthRes.data
          : (growthRes.data as any)?.data || [];
        if (gmList.length > 0) {
          const gm = gmList[0];
          growthRecords = {
            weightKg: gm.weightKg ?? gm.weight_kg ?? null,
            heightCm: gm.heightCm ?? gm.height_cm ?? null,
            headCircumferenceCm: gm.headCircumferenceCm ?? gm.head_circumference_cm ?? null,
          };
        }
      }
    } catch {}
  } else {
    const { start, end } = getLocalDayUtcRange(date);
    dayStartMs = new Date(start).getTime();
    dayEndMs = new Date(end).getTime();

    const results = await Promise.all([
      prisma.feedingRecord.findMany({
        where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } },
        orderBy: { timestamp: "asc" },
      }),
      prisma.sleepRecord.findMany({
        where: {
          babyId: ctx.babyId,
          startTime: { lt: end },
          endTime: { gt: start },
        },
        orderBy: { startTime: "asc" },
      }),
      prisma.diaperRecord.findMany({
        where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } },
        orderBy: { timestamp: "asc" },
      }),
      prisma.foodLogRecord.findMany({
        where: { babyId: ctx.babyId, date },
        orderBy: { time: "asc" },
      }),
      prisma.supplementRecord.findMany({
        where: { babyId: ctx.babyId, date },
        include: { product: true },
        orderBy: { time: "asc" },
      }),
      prisma.growthMeasurement.findFirst({
        where: { babyId: ctx.babyId, date },
        orderBy: { createdAt: "desc" },
      }),
      prisma.medicalReport.count({
        where: { babyId: ctx.babyId, date },
      }),
    ]);
    feedingRecords = results[0];
    sleepRecords = results[1];
    diaperRecords = results[2];
    foodLogs = results[3];
    supplementRecords = results[4];
    growthRecords = results[5];
    medicalReports = results[6];
  }

  // 1. Feeding Aggregations
  let totalFeedingMl = 0;
  let totalBreastMinutes = 0;
  let formulaCount = 0;
  let breastCount = 0;
  let spitUpCount = 0;

  const feedings: DailyFeedingDetail[] = feedingRecords.map((r) => {
    const effectiveMl = getFeedingEffectiveMl(r);
    totalFeedingMl += effectiveMl;
    const bMins = (r.leftMinutes || 0) + (r.rightMinutes || 0);
    totalBreastMinutes += bMins;

    if (r.type === "breast" || r.type === "bottle_breast") {
      breastCount += 1;
    } else if (r.type === "formula") {
      formulaCount += 1;
    } else if (r.type === "mixed") {
      formulaCount += 1;
      breastCount += 1;
    }
    if (r.spitUp) spitUpCount += 1;

    return {
      id: r.id,
      time: formatIsoToLocalTime(r.timestamp),
      type: r.type,
      typeName: TYPE_LABELS[r.type] || "喂奶",
      amountMl: r.amountMl ?? (effectiveMl > 0 ? effectiveMl : null),
      leftMinutes: r.leftMinutes,
      rightMinutes: r.rightMinutes,
      spitUp: r.spitUp,
      notes: r.notes,
    };
  });

  // 2. Sleep Aggregations
  let nightWakingCount = 0;
  let daySleepMinutes = 0;
  let nightSleepMinutes = 0;

  const validSleepIntervals = sleepRecords
    .map((r) => {
      const sMs = new Date(r.startTime).getTime();
      const eMs = new Date(r.endTime).getTime();
      return {
        record: r,
        origStartMs: sMs,
        origEndMs: eMs,
        clampedStartMs: Math.max(sMs, dayStartMs),
        clampedEndMs: Math.min(eMs, dayEndMs),
      };
    })
    .filter((iv) => iv.clampedEndMs > iv.clampedStartMs);

  const sleeps: DailySleepDetail[] = [];
  for (const iv of validSleepIntervals) {
    const durMins = Math.round((iv.clampedEndMs - iv.clampedStartMs) / 60000);
    nightWakingCount += iv.record.nightWakingCount || 0;

    const isNight = iv.record.type === "night";
    if (isNight) {
      nightSleepMinutes += durMins;
    } else {
      daySleepMinutes += durMins;
    }

    sleeps.push({
      id: iv.record.id,
      startTime: formatIsoToLocalTime(iv.record.startTime),
      endTime: formatIsoToLocalTime(iv.record.endTime),
      durationMinutes: durMins,
      type: iv.record.type === "night" ? "night" : "day",
      nightWakingCount: iv.record.nightWakingCount || 0,
      notes: iv.record.notes,
    });
  }

  // Calculate non-overlapping total sleep minutes
  const sortedIntervals = [...validSleepIntervals]
    .map((iv) => ({ startMs: iv.clampedStartMs, endMs: iv.clampedEndMs }))
    .sort((a, b) => a.startMs - b.startMs);

  let totalSleepMinutes = 0;
  let mergedStartMs = 0;
  let mergedEndMs = 0;
  for (const interval of sortedIntervals) {
    if (mergedEndMs === 0 || interval.startMs > mergedEndMs) {
      if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
      mergedStartMs = interval.startMs;
      mergedEndMs = interval.endMs;
    } else {
      mergedEndMs = Math.max(mergedEndMs, interval.endMs);
    }
  }
  if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);

  // 3. Diaper Aggregations
  let peeCount = 0;
  let poopCount = 0;
  const poopColorsSet = new Set<string>();
  const poopConsSet = new Set<string>();

  const diapers: DailyDiaperDetail[] = diaperRecords.map((r) => {
    if (r.type === "pee" || r.type === "both") peeCount += 1;
    if (r.type === "poop" || r.type === "both") {
      poopCount += 1;
      if (r.poopColor) poopColorsSet.add(POOP_COLOR_LABELS[r.poopColor] || r.poopColor);
      if (r.poopConsistency) poopConsSet.add(POOP_CONSISTENCY_LABELS[r.poopConsistency] || r.poopConsistency);
    }

    return {
      id: r.id,
      time: formatIsoToLocalTime(r.timestamp),
      type: r.type as "pee" | "poop" | "both",
      typeName: TYPE_LABELS[r.type] || "换尿布",
      poopColor: r.poopColor ? POOP_COLOR_LABELS[r.poopColor] || r.poopColor : null,
      poopConsistency: r.poopConsistency ? POOP_CONSISTENCY_LABELS[r.poopConsistency] || r.poopConsistency : null,
      notes: r.notes,
    };
  });

  // 4. Food Logs Aggregations
  const foodsTriedSet = new Set<string>();
  let hasFoodAbnormal = false;

  const foodLogsList: DailyFoodDetail[] = foodLogs.map((r) => {
    const parsedFoods = safeJsonParse<string[]>(r.foods, []);
    for (const f of parsedFoods) {
      if (f && typeof f === "string") foodsTriedSet.add(f.trim());
    }
    if (r.hasAbnormal) hasFoodAbnormal = true;

    return {
      id: r.id,
      time: r.time,
      foods: parsedFoods,
      portion: r.portion,
      acceptance: r.acceptance,
      babyState: r.babyState,
      hasAbnormal: r.hasAbnormal,
      abnormalNotes: r.abnormalNotes,
    };
  });

  // 5. Supplement Aggregations
  const supplementsList: DailySupplementDetail[] = supplementRecords.map((r) => ({
    id: r.id,
    time: r.time,
    name: r.product?.name || "营养补充剂",
    brand: r.product?.brand || "",
    dose: r.dose,
    unitName: r.unitName || r.product?.unitName || "份",
  }));

  return {
    date,
    totalFeedingMl,
    totalBreastMinutes,
    feedingCount: feedingRecords.length,
    formulaCount,
    breastCount,
    spitUpCount,
    feedings,

    totalSleepMinutes,
    daySleepMinutes,
    nightSleepMinutes,
    nightWakingCount,
    sleepCount: sleeps.length,
    sleeps,

    diaperCount: diaperRecords.length,
    peeCount,
    poopCount,
    poopColors: Array.from(poopColorsSet),
    poopConsistencies: Array.from(poopConsSet),
    diapers,

    foodCount: foodLogs.length,
    foodsTried: Array.from(foodsTriedSet),
    foodLogs: foodLogsList,

    supplementsCount: supplementRecords.length,
    supplements: supplementsList,

    hasAbnormal: hasFoodAbnormal || spitUpCount >= 3,
    growthMeasurement: growthRecords
      ? {
          weightKg: growthRecords.weightKg,
          heightCm: growthRecords.heightCm,
          headCircumferenceCm: growthRecords.headCircumferenceCm,
          percentile: growthRecords.percentile,
        }
      : null,
    medicalReportsCount: medicalReports,
  };
}

/**
 * High-quality curated pediatric summary generator.
 * Used as primary fallback when LLM API is unavailable, offline, or rate-limited.
 */
export function generateCuratedDailySummary(
  baby: any,
  metrics: DailyComprehensiveMetrics
): AiDailySummaryResult {
  const nickname = baby?.nickname || "宝宝";
  const ageDetail = baby?.birthDate ? calculateAgeDetail(baby.birthDate, metrics.date) : { months: 0, days: 0, totalDays: 0, label: "0个月" };
  const correctedAge = calculateCorrectedAge(baby?.birthDate, baby?.gestationalAge, metrics.date);

  const months = correctedAge.isPreterm ? correctedAge.correctedMonths : ageDetail.months;

  // Evaluate feeding
  let feedingEvaluation = "";
  const milkTargetMin = months < 6 ? 600 : months < 12 ? 600 : 400;
  const milkTargetMax = months < 6 ? 900 : months < 12 ? 800 : 500;

  if (metrics.totalFeedingMl > 0 || metrics.totalBreastMinutes > 0) {
    if (metrics.formulaCount > 0 && metrics.breastCount > 0) {
      feedingEvaluation = `今日共混合喂养 ${metrics.feedingCount} 次，总奶量累计约 ${metrics.totalFeedingMl}ml（含母乳亲喂 ${metrics.totalBreastMinutes} 分钟及配方奶/瓶喂）。母乳与奶量搭配充沛，按需哺乳节奏良好。`;
    } else if (metrics.totalBreastMinutes > 0 && metrics.formulaCount === 0) {
      feedingEvaluation = `今日母乳亲喂共 ${metrics.feedingCount} 次，累计时长 ${metrics.totalBreastMinutes} 分钟，估算摄入母乳约 ${metrics.totalFeedingMl}ml。亲喂频次与时长均符合月龄需求，妈妈辛苦了！`;
    } else if (metrics.totalFeedingMl > 0) {
      const ml = metrics.totalFeedingMl;
      if (ml >= milkTargetMin && ml <= milkTargetMax + 150) {
        feedingEvaluation = `今日共摄入奶量 ${ml}ml（分 ${metrics.feedingCount} 次），达到${months}月龄推荐奶量（${milkTargetMin}–${milkTargetMax}ml/天），喂养量充足稳定。`;
      } else if (ml < milkTargetMin) {
        feedingEvaluation = `今日记录总奶量 ${ml}ml（共 ${metrics.feedingCount} 次），略低于月龄建议区间（${milkTargetMin}–${milkTargetMax}ml）。若有辅食替代，请结合宝宝情绪及排尿情况综合观察。`;
      } else {
        feedingEvaluation = `今日共喝奶 ${ml}ml（共 ${metrics.feedingCount} 次），奶量胃口很好。注意喂奶后竖抱拍嗝，避免一次性过饱引起吐奶胀气。`;
      }
    }
  } else {
    feedingEvaluation = `今日暂未录入喂奶记录。若有喂养请及时记录，以获得更精准的摄入分析。`;
  }

  if (metrics.spitUpCount > 0) {
    feedingEvaluation += ` 今日有 ${metrics.spitUpCount} 次轻微吐奶记录，建议喂后竖抱轻拍嗝15-20分钟，床头可适当抬高15度防溢奶。`;
  }

  // Evaluate Food
  if (months >= 6) {
    if (metrics.foodCount > 0) {
      const foodNames = metrics.foodsTried.join("、") || "辅食餐点";
      feedingEvaluation += ` 辅食方面打卡 ${metrics.foodCount} 顿，尝试了【${foodNames}】，进食状况良好。`;
    } else {
      feedingEvaluation += ` ${months}月龄宝宝处于辅食添加黄金期，建议每日安排1-2次营养辅食（如高铁米粉、果蔬肉泥）。`;
    }
  }

  // Evaluate Sleep
  const totalSleepHours = (metrics.totalSleepMinutes / 60).toFixed(1);
  const daySleepHours = (metrics.daySleepMinutes / 60).toFixed(1);
  const nightSleepHours = (metrics.nightSleepMinutes / 60).toFixed(1);

  let sleepEvaluation = "";
  if (metrics.totalSleepMinutes > 0) {
    sleepEvaluation = `今日累计睡眠 ${totalSleepHours} 小时（夜间 ${nightSleepHours} 小时，白天小睡 ${daySleepHours} 小时，共 ${metrics.sleepCount} 段睡眠）。`;
    if (metrics.nightWakingCount > 0) {
      sleepEvaluation += ` 记录夜醒 ${metrics.nightWakingCount} 次。夜间可保持昏暗安静，轻拍安抚协助接觉，避免过度逗引。`;
    } else {
      sleepEvaluation += ` 夜间睡眠安稳连贯，昼夜生物节律建立良好。`;
    }
    if (months <= 3 && metrics.totalSleepMinutes < 720) {
      sleepEvaluation += ` 新生儿期建议保证 14-17 小时总睡眠，可适当减少单次清醒间隔（约 60-90 分钟）。`;
    } else if (months >= 4 && months <= 12 && metrics.totalSleepMinutes >= 720) {
      sleepEvaluation += ` 睡眠时长处于 ${months} 月龄标准推荐范围（12-15小时），精力恢复充分。`;
    }
  } else {
    sleepEvaluation = `今日暂无睡眠记录。及时记录小睡和入睡起止时间，有助于 AI 智能分析清醒间隔和并觉规律。`;
  }

  // Evaluate Diaper
  let diaperEvaluation = "";
  if (metrics.diaperCount > 0) {
    diaperEvaluation = `今日共换尿布 ${metrics.diaperCount} 次（嘘嘘 ${metrics.peeCount} 次，大便 ${metrics.poopCount} 次）。`;
    if (metrics.peeCount >= 5) {
      diaperEvaluation += ` 排尿次数 ≥ 5 次，说明体内水分与奶量补给充分。`;
    } else if (metrics.peeCount > 0 && metrics.peeCount < 4) {
      diaperEvaluation += ` 排尿次数偏少，请注意关注奶量或辅食水分摄入。`;
    }

    if (metrics.poopCount > 0) {
      const colors = metrics.poopColors.join("、") || "正常色泽";
      const cons = metrics.poopConsistencies.join("、") || "软糊状";
      diaperEvaluation += ` 大便呈【${colors}·${cons}】，肠道消化吸收正常。每次排便后建议温水清洗并涂抹护臀霜，预防红屁屁。`;
    } else {
      diaperEvaluation += ` 今日未排便，属于婴儿正常生理波动，可顺时针轻柔做腹部按摩促进肠蠕动。`;
    }
  } else {
    diaperEvaluation = `今日暂无尿布记录。排便与尿量是评估宝宝消化和补水情况的重要窗口。`;
  }

  // Evaluate Supplements & Growth & Health
  let growthAndCare = "";
  if (metrics.supplementsCount > 0) {
    const names = metrics.supplements.map((s) => s.name).join("、");
    growthAndCare = `今日已按时打卡补充剂【${names}】，营养素防护达标。`;
  } else {
    growthAndCare = `今日未见维生素D3打卡记录，建议每日按时补充 400IU 维生素D3 促进钙吸收。`;
  }

  if (metrics.growthMeasurement) {
    const g = metrics.growthMeasurement;
    const details = [];
    if (g.weightKg) details.push(`体重 ${g.weightKg}kg`);
    if (g.heightCm) details.push(`身长 ${g.heightCm}cm`);
    if (g.headCircumferenceCm) details.push(`头围 ${g.headCircumferenceCm}cm`);
    if (g.percentile) details.push(`百分位 P${g.percentile}`);
    growthAndCare += ` 今日记录了生长发育数据（${details.join("，")}），生长曲线平稳上行。`;
  }

  // Tomorrow Tips
  let tomorrowTips = "";
  if (months <= 3) {
    tomorrowTips = `1. 白天清醒时安排 2-3 次俯卧抬头（Tummy Time），每次 3-5 分钟练习颈部力量。\n2. 保持 60-90 分钟适度清醒间隔，出现揉眼/打哈欠等睡眠信号时及时哄睡。\n3. 与宝宝进行近距离黑白卡或亲子对视互动，促进视觉发育。`;
  } else if (months <= 6) {
    tomorrowTips = `1. 练习翻身和双手抓握摇铃，促进上肢大运动与精细协调。\n2. 白天安排 3 次小睡，单次清醒间隔控制在 1.5-2 小时之间。\n3. 满 6 个月后可准备开启第一道辅食（高铁米粉）。`;
  } else if (months <= 12) {
    tomorrowTips = `1. 辅食餐点可尝试引入新的蔬菜或肉泥单一过敏排查，丰富味觉体验。\n2. 练习独坐稳当、爬行探索及双手倒物手指食物，锻炼手眼协调。\n3. 每日安排 15 分钟亲子绘本共读与躲猫猫游戏。`;
  } else {
    tomorrowTips = `1. 保证一日三餐与规律家庭膳食接轨，鼓励自主进食与用吸管杯饮水。\n2. 每天安排至少 1-2 小时户外活动和散步迈步练习。\n3. 睡前固定温水洗澡、听绘本故事等睡眠仪式，培养自主入睡好习惯。`;
  }

  // Highlights & Status Calculation
  const highlights: string[] = [];
  if (metrics.totalFeedingMl >= milkTargetMin || metrics.totalBreastMinutes >= 40) {
    highlights.push("奶量达标充沛");
  }
  if (metrics.totalSleepMinutes >= 600) {
    highlights.push(`累计睡眠${totalSleepHours}h`);
  }
  if (metrics.peeCount >= 5) {
    highlights.push("水分补给充足");
  }
  if (metrics.supplementsCount > 0) {
    highlights.push("D3补剂已打卡");
  }
  if (metrics.foodCount > 0) {
    highlights.push(`打卡${metrics.foodCount}顿辅食`);
  }
  if (highlights.length === 0) {
    highlights.push("作息记录完整", "健康平稳");
  }

  let statusLevel: "excellent" | "good" | "attention" = "good";
  let overallScore = "作息规律 🌟";
  let overallRating = 4.5;

  if (metrics.hasAbnormal) {
    statusLevel = "attention";
    overallScore = "需多关注 💡";
    overallRating = 3.8;
  } else if (highlights.length >= 3 && metrics.totalSleepMinutes >= 660) {
    statusLevel = "excellent";
    overallScore = "状态极佳 ✨";
    overallRating = 5.0;
  }

  const headline = `今日${nickname}整体作息平稳，奶量与睡眠节律良好，生长状态棒棒哒！`;

  const suggestedQuestions = [
    `今天${nickname}的奶量和睡眠时长符合${months}月龄标准吗？`,
    months >= 6 ? "明天推荐安排哪种辅食食材？" : "宝宝白天清醒间隔多长最合适？",
    metrics.spitUpCount > 0 ? "宝宝轻微吐奶有什么快速缓解手法？" : "适合今天月龄的早教亲子互动有哪些？",
  ];

  return {
    date: metrics.date,
    babyId: baby?.id || "",
    babyName: nickname,
    babyAvatarUrl: baby?.avatarUrl || null,
    babyAgeLabel: correctedAge.isPreterm ? correctedAge.label : ageDetail.label,
    isPreterm: correctedAge.isPreterm,
    correctedAgeLabel: correctedAge.isPreterm ? `矫正月龄 ${correctedAge.correctedMonths}个月${correctedAge.correctedDays}天` : undefined,
    overallScore,
    overallRating,
    statusLevel,
    headline,
    highlights: highlights.slice(0, 4),
    sections: {
      feeding: feedingEvaluation,
      sleep: sleepEvaluation,
      diaper: diaperEvaluation,
      growthAndCare,
      tomorrowTips,
    },
    suggestedQuestions,
    metrics,
    disclaimer: "本总结由系统结合儿科指南与当日记录智能生成，仅供日常照护参考，不可作为医学临床诊断依据。",
    isAiGenerated: false,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Helper to check if a cached AI daily summary is still strictly fresh and accurate.
 */
function isDailySummaryCacheFresh(
  cachedSummary: AiDailySummaryResult,
  currentMetrics: DailyComprehensiveMetrics,
  isToday: boolean
): boolean {
  if (!cachedSummary.isAiGenerated) {
    return false;
  }

  const prev = cachedSummary.metrics;
  if (!prev) return false;

  const dataUnchanged =
    prev.feedingCount === currentMetrics.feedingCount &&
    prev.totalFeedingMl === currentMetrics.totalFeedingMl &&
    prev.totalBreastMinutes === currentMetrics.totalBreastMinutes &&
    prev.sleepCount === currentMetrics.sleepCount &&
    prev.totalSleepMinutes === currentMetrics.totalSleepMinutes &&
    prev.diaperCount === currentMetrics.diaperCount &&
    prev.peeCount === currentMetrics.peeCount &&
    prev.poopCount === currentMetrics.poopCount &&
    prev.foodCount === currentMetrics.foodCount &&
    prev.supplementsCount === currentMetrics.supplementsCount;

  // Past dates: fresh as long as records were not retroactively edited
  if (!isToday) {
    return dataUnchanged;
  }

  // Today: if record count or totals changed, cache is stale immediately
  if (!dataUnchanged) {
    return false;
  }

  // Today: if generated more than 3 hours ago during active daytime, refresh to stay current
  const genMs = new Date(cachedSummary.generatedAt).getTime();
  if (Number.isFinite(genMs) && Date.now() - genMs > 3 * 3600 * 1000) {
    return false;
  }

  return true;
}

interface CandidateProfile {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
  completionExtras?: Record<string, unknown>;
}

function resolveCandidateProfiles(): CandidateProfile[] {
  const list: CandidateProfile[] = [];
  try {
    const { activeProfile, profiles } = getLlmProfiles();
    const active = profiles[activeProfile];
    if (active?.baseUrl && active?.apiKey) {
      list.push(formatCandidate(activeProfile, active));
    }
    for (const [key, p] of Object.entries(profiles)) {
      if (key !== activeProfile && p.baseUrl && p.apiKey) {
        list.push(formatCandidate(key, p));
      }
    }
  } catch (err) {
    console.warn("[AI Daily Summary] Failed to load LLM profiles:", err);
  }

  if (list.length === 0 && AI_CONFIG.baseUrl && AI_CONFIG.apiKey) {
    list.push({
      name: "default",
      baseUrl: AI_CONFIG.baseUrl.replace(/\/+$/, ""),
      apiKey: AI_CONFIG.apiKey,
      model: AI_CONFIG.model,
      headers: AI_CONFIG.headers,
      completionExtras: AI_CONFIG.completionExtras,
    });
  }

  return list;
}

function formatCandidate(key: string, p: LlmProfile): CandidateProfile {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(p.headers || {}),
  };
  if (p.apiKey) {
    headers.Authorization = `Bearer ${p.apiKey}`;
  }
  if (p.baseUrl.includes("openrouter.ai") && !headers["HTTP-Referer"]) {
    headers["HTTP-Referer"] = "https://baby.zwang.fun";
    headers["X-Title"] = "Baby Panel";
  }

  let model = p.model;
  if (model === "hermes-agent" || (p.baseUrl.includes("opencode.ai") && model.includes("muse-spark"))) {
    model = "Qwen3.8-Flash-Next";
  }

  return {
    name: key,
    baseUrl: p.baseUrl.replace(/\/+$/, ""),
    apiKey: p.apiKey,
    model,
    headers,
    completionExtras: p.completionExtras,
  };
}

export const summaryMemoryCache = new Map<string, { summary: AiDailySummaryResult; timestamp: number }>();

/**
 * Generate AI Daily Summary via LLM (OpenRouter / Opencode / AMD) with robust error handling and fallback.
 */
export async function generateAiDailySummary(
  ctx: RecordContext,
  targetDateStr?: string,
  options?: { forceRefresh?: boolean }
): Promise<AiDailySummaryResult> {
  const date =
    targetDateStr && isValidDateStr(targetDateStr)
      ? targetDateStr
      : getLocalDateStr();

  const baby = ctx.baby || (await prisma.baby.findUnique({ where: { id: ctx.babyId } }));
  if (!baby) {
    throw new Error("未找到宝宝档案");
  }

  // 1. Gather comprehensive stats for the day
  const metrics = await fetchDailyComprehensiveMetrics(
    {
      userId: ctx.userId,
      babyId: baby.id,
      accessToken: ctx.accessToken,
      familyId: ctx.familyId,
    },
    date
  );

  // 2. Build default high-quality rule-based summary
  const curatedFallback = generateCuratedDailySummary(baby, metrics);

  // If no AI key configured or in test environment, return curated summary directly
  if (!AI_CONFIG.apiKey) {
    return curatedFallback;
  }

  const ageDetail = calculateAgeDetail(baby.birthDate, date);
  const correctedAge = calculateCorrectedAge(baby.birthDate, baby.gestationalAge, date);
  const nickname = baby.nickname || "宝宝";
  const genderWord = baby.gender === "male" ? "男宝" : "女宝";

  const todayStr = getLocalDateStr();
  const isToday = date === todayStr;

  // Check cache unless forceRefresh is true
  const cacheKey = `ai_daily_summary_${baby.id}_${date}`;
  if (!options?.forceRefresh) {
    if (isGrowDeskEnabled()) {
      const cached = summaryMemoryCache.get(cacheKey);
      if (cached && isDailySummaryCacheFresh(cached.summary, metrics, isToday)) {
        return {
          ...cached.summary,
          metrics,
        };
      }
    } else {
      try {
        const cached = await prisma.aiArchive.findFirst({
          where: { kind: "output_json", content: { startsWith: `{"_cacheKey":"${cacheKey}"` } },
          orderBy: { createdAt: "desc" },
        });
        if (cached?.content) {
          const parsed = JSON.parse(cached.content);
          const cachedSummary = parsed?.summary as AiDailySummaryResult | undefined;
          if (cachedSummary && isDailySummaryCacheFresh(cachedSummary, metrics, isToday)) {
            return {
              ...cachedSummary,
              metrics, // keep fresh raw metrics
            };
          }
        }
      } catch {}
    }
  }

  // 3. Build Prompt for LLM
  const promptData = {
    baby: {
      name: nickname,
      gender: genderWord,
      birthDate: baby.birthDate,
      chronologicalAge: ageDetail.label,
      isPreterm: correctedAge.isPreterm,
      correctedAge: correctedAge.isPreterm ? `矫正 ${correctedAge.correctedMonths}个月${correctedAge.correctedDays}天` : undefined,
    },
    date,
    stats: {
      totalMilkMl: metrics.totalFeedingMl,
      totalBreastMinutes: metrics.totalBreastMinutes,
      feedingCount: metrics.feedingCount,
      formulaCount: metrics.formulaCount,
      breastCount: metrics.breastCount,
      spitUpCount: metrics.spitUpCount,
      feedings: metrics.feedings,

      totalSleepHours: (metrics.totalSleepMinutes / 60).toFixed(1),
      daySleepHours: (metrics.daySleepMinutes / 60).toFixed(1),
      nightSleepHours: (metrics.nightSleepMinutes / 60).toFixed(1),
      nightWakingCount: metrics.nightWakingCount,
      sleepSessionsCount: metrics.sleepCount,
      sleeps: metrics.sleeps,

      diaperCount: metrics.diaperCount,
      peeCount: metrics.peeCount,
      poopCount: metrics.poopCount,
      poopColors: metrics.poopColors,
      poopConsistencies: metrics.poopConsistencies,

      foodCount: metrics.foodCount,
      foodsTried: metrics.foodsTried,
      foodLogs: metrics.foodLogs,

      supplements: metrics.supplements.map((s) => `${s.name} ${s.dose}${s.unitName || ""}`),
      growthMeasurement: metrics.growthMeasurement,
    },
  };

  const systemPrompt = `你是一位权威、温暖且贴心的儿科与婴幼儿生长发育专家（宝宝成长工作台AI健康管家）。
你的任务是根据宝宝档案及今日的真实作息数据（喂养、睡眠、排便、辅食、补剂等），为家长生成一份专业、有爱、条理清晰的【每日成长总结与健康日报】。

【评估指南与医学常识】
1. 0-6个月：按需喂养，总奶量通常约 600-900ml/天；总睡眠约 13-17 小时；每日补充 400IU 维生素D3；排尿 ≥ 5-6 次表明补水充足。
2. 6-12个月：辅食逐步引入（高铁米粉、果蔬肉泥），奶量保持 600-800ml/天；白天通常2次小睡；注意食物过敏排查与性状过渡。
3. 1-3岁：三餐膳食与家庭饮食接轨，奶量约 400-500ml/天；鼓励自主进食与大运动探索。
4. 语言风格：鼓励肯定家长的悉心照料，语气亲切温暖，分项明确，指出亮点与注意事项，给出具体的明日实操指导。
5. 必须返回严格且符合以下 JSON 结构的纯 JSON 格式：

{
  "overallScore": "作息规律 🌟" | "状态极佳 ✨" | "平稳达标 👍" | "需多关注 💡",
  "overallRating": 4.8,
  "statusLevel": "excellent" | "good" | "attention",
  "headline": "一句话温暖精炼的今日总结亮点（如：今日小希奶量达标780ml，午后小睡安稳，整体作息节奏非常规律！）",
  "highlights": ["奶量达标", "夜醒仅1次", "D3已打卡", "大便金黄成形"],
  "sections": {
    "feeding": "🍼 喂养与营养摄入评估（分析总奶量、亲喂时长、辅食添加与接受度、有无吐奶等，对照月龄标准给出科学解读与肯定）",
    "sleep": "😴 作息与睡眠节律评估（分析白天小睡、夜间睡眠总时长、清醒间隔、夜醒接觉状况，给出节律评价）",
    "diaper": "💩 排便与肠胃舒适度（分析换尿布频次、排尿量、大便颜色形态及肠道消化吸收情况，提醒臀部护理）",
    "growthAndCare": "📈 生长发育与营养补剂（评估维生素D3打卡、微量元素补充、身体测量指标与日常体感）",
    "tomorrowTips": "💡 明日照护贴士与早教建议（列出2-3条明日具体的照护要点、清醒间隔建议、趴卧/大运动/绘本早教小游戏）"
  },
  "suggestedQuestions": [
    "针对今日情况可以向AI追问的问题1",
    "针对今日情况可以向AI追问的问题2",
    "针对今日情况可以向AI追问的问题3"
  ]
}`;

  const candidates = resolveCandidateProfiles();
  if (candidates.length === 0) {
    console.warn("[AI Daily Summary] No valid AI credentials configured, returning curated fallback.");
    return curatedFallback;
  }

  let parsed: any = null;

  for (const candidate of candidates) {
    const timeoutMs = 70000;
    try {
      console.log(`[AI Daily Summary] Generating via profile "${candidate.name}" (${candidate.model})...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${candidate.baseUrl}/chat/completions`, {
          method: "POST",
          headers: candidate.headers,
          body: JSON.stringify({
            model: candidate.model,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `请为${ageDetail.label}的${genderWord}宝宝「${nickname}」生成 ${date} 的每日成长总结与健康日报。数据如下：\n${JSON.stringify(promptData, null, 2)}`,
              },
            ],
            temperature: 0.6,
            max_tokens: 1800,
            ...candidate.completionExtras,
          }),
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          console.warn(`[AI Daily Summary] Profile "${candidate.name}" returned HTTP ${res.status}: ${errorText.slice(0, 150)}`);
          continue;
        }

        const jsonRes = await res.json();
        const choice = jsonRes.choices?.[0]?.message;
        const content = (choice?.content || choice?.reasoning_content || "");

        // Match JSON block: code block or raw JSON object
        const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
        const jsonStr = match ? (match[1] || match[0]) : "";
        if (!jsonStr) {
          console.warn(`[AI Daily Summary] Profile "${candidate.name}" response missing JSON block`);
          continue;
        }

        const candidateParsed = JSON.parse(jsonStr);
        if (candidateParsed?.sections && candidateParsed?.headline) {
          parsed = candidateParsed;
          console.log(`[AI Daily Summary] Successfully generated summary via profile "${candidate.name}" (${candidate.model}) for ${nickname} on ${date}`);
          break;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError";
      console.warn(`[AI Daily Summary] Profile "${candidate.name}" failed: ${isTimeout ? `Timeout after ${timeoutMs}ms` : err?.message || err}`);
    }
  }

  if (!parsed) {
    console.warn("[AI Daily Summary] All LLM candidate profiles failed. Falling back to curated rule-based summary.");
    return curatedFallback;
  }

  const aiResult: AiDailySummaryResult = {
    date,
    babyId: baby.id,
    babyName: nickname,
    babyAvatarUrl: baby.avatarUrl || null,
    babyAgeLabel: correctedAge.isPreterm ? correctedAge.label : ageDetail.label,
    isPreterm: correctedAge.isPreterm,
    correctedAgeLabel: correctedAge.isPreterm ? `矫正月龄 ${correctedAge.correctedMonths}个月${correctedAge.correctedDays}天` : undefined,
    overallScore: String(parsed.overallScore || curatedFallback.overallScore),
    overallRating: typeof parsed.overallRating === "number" ? Math.min(5, Math.max(1, parsed.overallRating)) : curatedFallback.overallRating,
    statusLevel: ["excellent", "good", "attention"].includes(parsed.statusLevel) ? parsed.statusLevel : curatedFallback.statusLevel,
    headline: String(parsed.headline || curatedFallback.headline),
    highlights: Array.isArray(parsed.highlights) && parsed.highlights.length > 0 ? parsed.highlights.slice(0, 5) : curatedFallback.highlights,
    sections: {
      feeding: String(parsed.sections.feeding || curatedFallback.sections.feeding),
      sleep: String(parsed.sections.sleep || curatedFallback.sections.sleep),
      diaper: String(parsed.sections.diaper || curatedFallback.sections.diaper),
      growthAndCare: String(parsed.sections.growthAndCare || curatedFallback.sections.growthAndCare),
      tomorrowTips: String(parsed.sections.tomorrowTips || curatedFallback.sections.tomorrowTips),
    },
    suggestedQuestions: Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.length > 0
      ? parsed.suggestedQuestions.slice(0, 4)
      : curatedFallback.suggestedQuestions,
    metrics,
    disclaimer: "本总结由 AI 结合儿科指南与当日记录智能生成，仅供日常照护参考，不可作为医学临床诊断依据。",
    isAiGenerated: true,
    generatedAt: new Date().toISOString(),
  };

  // Save into AiArchive for fast cache & audit
  if (isGrowDeskEnabled()) {
    summaryMemoryCache.set(cacheKey, { summary: aiResult, timestamp: Date.now() });
  }

  void archiveText("output_json", JSON.stringify({
    _cacheKey: cacheKey,
    summary: aiResult,
    generatedAt: aiResult.generatedAt,
    babyId: baby.id,
    date,
  })).catch((err) => console.warn("Failed to archive AI daily summary:", err));

  return aiResult;
}

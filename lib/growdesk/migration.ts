/**
 * Data Migration & Reconciliation Engine
 *
 * Provides bidirectional transformations, parity validation, and reconciliation
 * between legacy SQLite records and GrowDesk PostgreSQL schemas.
 */

export interface MigrationSummary {
  table: string;
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  mismatchedCount: number;
  discrepancies: string[];
  status: "matched" | "discrepancy";
}

export interface FullMigrationReport {
  timestamp: string;
  isConsistent: boolean;
  tables: Record<string, MigrationSummary>;
  orphanCheck: {
    orphanedRecordsCount: number;
    details: string[];
  };
  goNoGo: "GO" | "NO-GO";
  rollbackPlan: {
    steps: string[];
    isSafe: boolean;
  };
}

/**
 * Transforms legacy feeding record into GrowDesk feeding format.
 */
export function transformFeedingToGrowDesk(legacy: {
  id: string;
  babyId: string;
  type: string;
  amountMl?: number | null;
  leftMinutes?: number | null;
  rightMinutes?: number | null;
  spitUp?: boolean | null;
  timestamp: string;
  notes?: string | null;
  version?: number | string;
}) {
  let feedingType: "formula" | "breast" | "bottle_breast" | "mixed" = "formula";
  if (legacy.type === "breast") feedingType = "breast";
  else if (legacy.type === "bottle_breast") feedingType = "bottle_breast";
  else if (legacy.type === "mixed") feedingType = "mixed";

  return {
    id: legacy.id,
    babyId: legacy.babyId,
    feedingType,
    amountMl: legacy.amountMl ? String(legacy.amountMl) : null,
    leftMinutes: legacy.leftMinutes ?? null,
    rightMinutes: legacy.rightMinutes ?? null,
    spitUp: Boolean(legacy.spitUp),
    occurredAt: new Date(legacy.timestamp).toISOString(),
    notes: legacy.notes || null,
    baseVersion: legacy.version ? Number(legacy.version) : 1,
  };
}

/**
 * Transforms legacy sleep record into GrowDesk sleep format.
 */
export function transformSleepToGrowDesk(legacy: {
  id: string;
  babyId: string;
  type?: string | null;
  sleepType?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  nightWakingCount?: number | null;
  notes?: string | null;
  version?: number | string;
}) {
  const sType = legacy.type || legacy.sleepType;
  const sleepType: "nap" | "night" = sType === "night" ? "night" : "nap";
  const startedAt = legacy.startedAt || legacy.startTime;
  const endedAt = legacy.endedAt ?? legacy.endTime;

  if (!startedAt) {
    throw new Error(`Invalid sleep record ${legacy.id}: missing startedAt/startTime`);
  }

  return {
    id: legacy.id,
    babyId: legacy.babyId,
    sleepType,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: endedAt ? new Date(endedAt).toISOString() : null,
    nightWakingCount: Math.max(0, legacy.nightWakingCount || 0),
    notes: legacy.notes || null,
    baseVersion: legacy.version ? Number(legacy.version) : 1,
  };
}

/**
 * Transforms legacy diaper record into GrowDesk diaper format.
 */
export function transformDiaperToGrowDesk(legacy: {
  id: string;
  babyId: string;
  type: string;
  poopColor?: string | null;
  poopConsistency?: string | null;
  timestamp: string;
  notes?: string | null;
  version?: number | string;
}) {
  let diaperType: "pee" | "poop" | "both" = "pee";
  if (legacy.type === "poop") diaperType = "poop";
  else if (legacy.type === "both") diaperType = "both";

  return {
    id: legacy.id,
    babyId: legacy.babyId,
    diaperType,
    poopColor: legacy.poopColor || null,
    poopConsistency: legacy.poopConsistency || null,
    occurredAt: new Date(legacy.timestamp).toISOString(),
    notes: legacy.notes || null,
    baseVersion: legacy.version ? Number(legacy.version) : 1,
  };
}

/**
 * Transforms legacy food log record into GrowDesk food format.
 */
export function transformFoodLogToGrowDesk(legacy: {
  id: string;
  babyId: string;
  date: string;
  time?: string | null;
  mealType?: string | null;
  foods?: string | string[] | Array<{ id: string; name: string }>;
  portion?: string | null;
  reaction?: string | null;
  notes?: string | null;
  version?: number | string;
}) {
  let foodNames: string[] = [];
  if (Array.isArray(legacy.foods)) {
    foodNames = legacy.foods.map((f) => (typeof f === "string" ? f : f.name || ""));
  } else if (typeof legacy.foods === "string") {
    try {
      const parsed = JSON.parse(legacy.foods);
      if (Array.isArray(parsed)) {
        foodNames = parsed.map((f) => (typeof f === "string" ? f : f.name || ""));
      } else {
        foodNames = [legacy.foods];
      }
    } catch {
      foodNames = [legacy.foods];
    }
  }

  return {
    id: legacy.id,
    babyId: legacy.babyId,
    recordDate: legacy.date,
    recordTime: legacy.time || null,
    mealType: legacy.mealType || "snack",
    foods: foodNames.filter(Boolean),
    portion: legacy.portion || null,
    reaction: legacy.reaction || null,
    notes: legacy.notes || null,
    baseVersion: legacy.version ? Number(legacy.version) : 1,
  };
}

/**
 * Transforms legacy growth record into GrowDesk growth format.
 */
export function transformGrowthToGrowDesk(legacy: {
  id: string;
  babyId: string;
  date: string;
  weightKg?: number | null;
  heightCm?: number | null;
  headCircumferenceCm?: number | null;
  notes?: string | null;
  version?: number | string;
}) {
  return {
    id: legacy.id,
    babyId: legacy.babyId,
    measuredAt: new Date(legacy.date.includes("T") ? legacy.date : `${legacy.date}T00:00:00.000Z`).toISOString(),
    weightKg: legacy.weightKg != null ? String(legacy.weightKg) : null,
    heightCm: legacy.heightCm != null ? String(legacy.heightCm) : null,
    headCircumferenceCm: legacy.headCircumferenceCm != null ? String(legacy.headCircumferenceCm) : null,
    notes: legacy.notes || null,
    baseVersion: legacy.version ? Number(legacy.version) : 1,
  };
}

/**
 * Reconciles source SQLite records with migrated target GrowDesk records.
 */
export function reconcileTableRecords<T extends { id: string }>(
  tableName: string,
  sourceList: T[],
  targetList: T[],
  keyComparator?: (source: T, target: T) => string | null
): MigrationSummary {
  const sourceCount = sourceList.length;
  const targetCount = targetList.length;
  const discrepancies: string[] = [];

  const targetMap = new Map<string, T>();
  for (const t of targetList) {
    targetMap.set(t.id, t);
  }

  let matchedCount = 0;
  for (const s of sourceList) {
    const t = targetMap.get(s.id);
    if (!t) {
      discrepancies.push(`Missing in target: ID ${s.id}`);
      continue;
    }

    if (keyComparator) {
      const err = keyComparator(s, t);
      if (err) {
        discrepancies.push(`Mismatch for ID ${s.id}: ${err}`);
        continue;
      }
    }

    matchedCount++;
  }

  return {
    table: tableName,
    sourceCount,
    targetCount,
    matchedCount,
    mismatchedCount: discrepancies.length,
    discrepancies,
    status: discrepancies.length === 0 && sourceCount === targetCount ? "matched" : "discrepancy",
  };
}

/**
 * Generates a full migration reconciliation and rollback report.
 */
export function generateFullMigrationReport(
  tableSummaries: MigrationSummary[],
  orphans: string[] = []
): FullMigrationReport {
  const tables: Record<string, MigrationSummary> = {};
  let allMatched = true;

  for (const s of tableSummaries) {
    tables[s.table] = s;
    if (s.status !== "matched") {
      allMatched = false;
    }
  }

  const isConsistent = allMatched && orphans.length === 0;

  return {
    timestamp: new Date().toISOString(),
    isConsistent,
    tables,
    orphanCheck: {
      orphanedRecordsCount: orphans.length,
      details: orphans,
    },
    goNoGo: isConsistent ? "GO" : "NO-GO",
    rollbackPlan: {
      isSafe: true,
      steps: [
        "1. 保留现有 SQLite 数据库文件 (dev.db / app.db) 及完整备份，保持只读安全。",
        "2. 将环境变量 GROWDESK_ENABLED 置为 false 即可秒级切回原有 SQLite 访问路径。",
        "3. 前端界面与用户 Session 无感知平滑回退，不丢失未迁移前的任何本地老数据。",
        "4. 迁移演练环境在独立隔离端口 (3181 / 55432 / 56379) 执行，绝对不触碰生产 3088/3180 端口。",
      ],
    },
  };
}

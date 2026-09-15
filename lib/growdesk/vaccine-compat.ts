import fs from "node:fs";
import path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyVaccineRecord {
  id: string;
  babyId: string;
  name: string;
  vaccineId?: string;
  dose: string;
  scheduledDate: string;
  completedDate: string | null;
  isCompleted: boolean;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskVaccineRecord {
  id: string;
  babyId: string;
  familyId: string;
  vaccineCode: string;
  administeredDate: string;
  clinic: string | null;
  batchNumber: string | null;
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowDeskVaccineScheduleItem {
  id: string;
  vaccineCode: string;
  name: string;
  recommendedAgeMonths: number;
  doseNumber: number;
  mandatory: boolean;
}

export interface VaccineSelectionItem {
  vaccineId: string;
  doseNumber: number;
  selected: boolean;
  completed: boolean;
  recordId?: string | null;
}

export function parseDoseNumber(val: unknown): number {
  if (typeof val === "number" && Number.isInteger(val) && val >= 1) return val;
  if (typeof val === "string") {
    const match = val.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      if (num >= 1 && num <= 12) return num;
    }
  }
  return 1;
}

export function toGrowDeskVaccineRecordPayload(body: Record<string, unknown>) {
  const code = String(body.vaccineId || body.vaccineCode || body.name || "").trim();
  const administeredDate = String(
    body.completedDate || body.scheduledDate || body.administeredDate || new Date().toISOString().slice(0, 10),
  ).trim();

  const clinic = body.clinic ? String(body.clinic).trim() : null;
  const batchNumber = body.batchNumber ? String(body.batchNumber).trim() : null;

  let notes = body.notes ? String(body.notes).trim() : null;
  const rawDose = body.dose !== undefined && body.dose !== null ? String(body.dose).trim() : (body.doseNumber !== undefined && body.doseNumber !== null ? String(body.doseNumber).trim() : "");
  if (rawDose && !notes?.includes("剂次")) {
    notes = notes ? `${notes} (剂次: ${rawDose})` : `剂次: ${rawDose}`;
  } else if (!notes?.includes("剂次")) {
    const doseNum = parseDoseNumber(body.dose || body.doseNumber);
    const doseLabel = `第${doseNum}剂`;
    notes = notes ? `${notes} (剂次: ${doseLabel})` : `剂次: ${doseLabel}`;
  }

  return {
    vaccineCode: code,
    administeredDate,
    clinic,
    batchNumber,
    notes,
  };
}

export function fromGrowDeskVaccineRecord(rec: GrowDeskVaccineRecord): LegacyVaccineRecord {
  let dose = "第1剂";
  if (rec.notes) {
    const m = rec.notes.match(/(?:第\s*(\d+)\s*剂|剂次:\s*第?(\d+)剂?)/);
    if (m) {
      const num = m[1] || m[2];
      dose = `第${num}剂`;
    }
  }

  return {
    id: rec.id,
    babyId: rec.babyId,
    name: rec.vaccineCode,
    vaccineId: rec.vaccineCode,
    dose,
    scheduledDate: rec.administeredDate,
    completedDate: rec.administeredDate,
    isCompleted: true,
    notes: rec.notes,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

let cachedKnowledgeBase: any = null;

function getRawVaccineData(): any {
  if (cachedKnowledgeBase) return cachedKnowledgeBase;
  const filePath = path.join(process.cwd(), "data", "02_vaccines.json");
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      cachedKnowledgeBase = JSON.parse(content);
      return cachedKnowledgeBase;
    } catch (e) {
      console.warn("Failed to parse 02_vaccines.json:", e);
    }
  }
  return {};
}

export function loadFullVaccineKnowledge(regionCode = "CN-JS") {
  const raw = getRawVaccineData();
  const rawVaccines: any[] = raw.vaccines || [];
  const rawSchedule: any[] = raw.vaccineSchedule || [];
  const rawOptionalTimeline: any[] = raw.optionalVaccineTimeline || [];
  const rawTemplates: any[] = raw.vaccineStrategyTemplates || [];
  const rawEngineRules: any[] = raw.scheduleEngineRules || [];

  const vaccinesWithOverrides = rawVaccines.map((v) => {
    let programType = v.programType;
    let feeType = v.programType === "national_immunization_program" ? "free" : "paid";
    let appliedOverride: any = null;

    const regionalOverrides = v.regionalProgramOverrides || v.regionalOverrides || [];
    if (Array.isArray(regionalOverrides)) {
      const override = regionalOverrides.find((o: any) => o.regionCode === regionCode);
      if (override) {
        programType = override.programType;
        feeType = override.feeType;
        appliedOverride = override;
      }
    }

    let doses = Array.isArray(v.doses) ? [...v.doses] : [];
    if (doses.length === 0 && Array.isArray(v.regimenOptions) && v.regimenOptions.length > 0) {
      const activeRegimen =
        v.regimenOptions.find((r: any) => r.region?.includes("江苏") || r.programType === programType) ||
        v.regimenOptions[0];
      if (Array.isArray(activeRegimen?.agesMonths)) {
        doses = activeRegimen.agesMonths.map((m: number, idx: number) => ({
          doseNumber: idx + 1,
          doseLabel: `第${idx + 1}剂`,
          recommendedAgeMonths: m,
        }));
      }
    }

    return {
      id: v.id,
      vaccineId: v.id,
      name: v.name,
      shortName: v.shortName,
      englishName: v.englishName,
      programType,
      feeType,
      legacyLabel: v.legacyLabel,
      sexRestriction: v.sexRestriction,
      chinaNational: v.chinaNational,
      regionalOverride: appliedOverride,
      diseases: Array.isArray(v.diseases) ? v.diseases : [],
      catchUpRules: v.catchUpRules || null,
      substitutionRules: v.substitutionRules || null,
      contraindications: v.contraindications || null,
      precautions: v.precautions || null,
      specialPopulations: v.specialPopulations || null,
      regionalOverrides,
      regimenOptions: v.regimenOptions || null,
      notes: v.notes || null,
      doses: doses.map((d: any) => ({
        doseNumber: d.doseNumber,
        doseLabel: d.doseLabel || `第${d.doseNumber}剂`,
        recommendedAgeMonths: d.recommendedAgeMonths,
        minimumAgeDays: d.minimumAgeDays,
        recommendedAgeMaxMonths: d.recommendedAgeMaxMonths,
        minimumIntervalDaysFromPrevious: d.minimumIntervalDaysFromPrevious,
        route: d.route,
        site: d.site,
        notes: d.notes,
      })),
    };
  });

  const national = vaccinesWithOverrides.filter((v) => v.programType === "national_immunization_program");
  const provincial = vaccinesWithOverrides.filter((v) => v.programType === "provincial_immunization_program");
  const nonProgram = vaccinesWithOverrides.filter((v) => v.programType === "non_program");

  const scheduleEntries: any[] = [];
  for (const entry of rawSchedule) {
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        scheduleEntries.push({
          vaccineId: item.vaccineId,
          doseNumber: item.doseNumber,
          ageMonths: entry.ageMonths ?? null,
          ageDays: entry.ageDays ?? null,
          ageLabel: entry.ageLabel ?? (entry.ageMonths !== null ? `${entry.ageMonths}月龄` : null),
          isOptional: false,
          action: item.action || "按常规程序接种",
          selectionGroup: item.selectionGroup || null,
        });
      }
    }
  }

  for (const entry of rawOptionalTimeline) {
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        scheduleEntries.push({
          vaccineId: item.vaccineId,
          doseNumber: item.doseNumber || 1,
          ageMonths: entry.ageMonths ?? null,
          ageDays: entry.ageDays ?? null,
          ageLabel: entry.ageLabel ?? (entry.ageMonths !== null ? `${entry.ageMonths}月龄` : null),
          isOptional: true,
          action: item.action || "可选接种",
          selectionGroup: item.selectionGroup || null,
        });
      }
    }
  }

  const strategyGroups = rawTemplates.map((t) => ({
    id: t.id,
    groupId: t.id,
    name: t.name,
    description: t.scope || t.baseProgram || "",
    optionsJson: JSON.stringify(t.optionalSelections || []),
    sourceRefsJson: JSON.stringify(t.sourceRefs || []),
  }));

  const engineRules = rawEngineRules.map((r) => ({
    id: r.id,
    ruleId: r.id,
    ruleType: r.type || "mutex",
    description: r.description || "",
    vaccineIdsJson: JSON.stringify(r.vaccineIds || []),
    sourceRefsJson: JSON.stringify(r.sourceRefs || []),
  }));

  const dataRelease = raw.datasetMeta
    ? {
        version: raw.datasetMeta.asOf || "2026-08-03",
        scope: raw.datasetMeta.scope,
        asOf: raw.datasetMeta.asOf,
        localDefaultRegion: raw.datasetMeta.localDefaultRegion,
      }
    : null;

  return {
    vaccines: vaccinesWithOverrides,
    national,
    provincial,
    nonProgram,
    schedule: scheduleEntries,
    strategyGroups,
    engineRules,
    dataRelease,
  };
}

export function buildVaccineSelections(
  records: GrowDeskVaccineRecord[],
  savedSelections?: Record<string, { selected?: boolean; completed?: boolean }>,
): VaccineSelectionItem[] {
  const result: VaccineSelectionItem[] = [];
  const recordMap = new Map<string, GrowDeskVaccineRecord>();

  for (const rec of records) {
    const doseNum = parseDoseNumber(rec.notes);
    const key = `${rec.vaccineCode}-${doseNum}`;
    recordMap.set(key, rec);
  }

  const fullKb = loadFullVaccineKnowledge();
  const allVaccines = fullKb.vaccines || [];

  for (const v of allVaccines) {
    const doses = Array.isArray(v.doses) && v.doses.length > 0 ? v.doses : [{ doseNumber: 1 }];
    for (const d of doses) {
      const key = `${v.vaccineId}-${d.doseNumber}`;
      const rec = recordMap.get(key) || recordMap.get(`${v.name}-${d.doseNumber}`);
      const saved = savedSelections ? savedSelections[key] : undefined;

      const isCompleted = Boolean(rec || saved?.completed);
      const isSelected = saved?.selected !== undefined ? saved.selected : true;

      result.push({
        vaccineId: v.vaccineId,
        doseNumber: d.doseNumber,
        selected: isSelected,
        completed: isCompleted,
        recordId: rec ? rec.id : null,
      });
    }
  }

  return result;
}

import fs from "node:fs";
import path from "node:path";
import vaccineDataset from "../../data/02_vaccines.json";
import sourcesDataset from "../../data/01_sources.json";
import {
  legacyDataReleaseId,
  legacyFixtureCreatedAt,
  legacyFixtureSiblingId,
  legacyReferenceId,
  legacyScheduleEngineRuleId,
  legacySourceRefId,
  legacyVaccineDoseId,
  legacyVaccineId,
  legacyVaccineStrategyGroupId,
} from "./knowledge-legacy-id";

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
  vaccineId?: string | null;
  doseNumber?: number | null;
  legacyName?: string | null;
  legacyDose?: string | null;
  administeredDate: string;
  scheduledDate?: string | null;
  completedDate?: string | null;
  isCompleted?: boolean;
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

/**
 * Convert the normalized vaccine graph into the object shape consumed by the
 * existing Web vaccine screens. The normalized service owns the graph rows;
 * this adapter only restores legacy aliases and applies the requested region.
 */
export function fromGrowDeskVaccineCatalog(raw: unknown, regionCode = "CN-JS") {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : {};
  const rows = [
    ...(Array.isArray(source.national) ? source.national : []),
    ...(Array.isArray(source.nonProgram) ? source.nonProgram : []),
    ...(Array.isArray(source.provincial) ? source.provincial : []),
  ] as Record<string, any>[];
  const byKey = new Map<string, Record<string, any>>();
  const vaccines = rows.map((row) => {
    const key = String(row.id || row.vaccineCode || row.name);
    if (byKey.has(key)) return byKey.get(key)!;
    const overrides = Array.isArray(row.regionalOverrides) ? row.regionalOverrides : [];
    const override = overrides.find((item: any) => item && item.regionCode === regionCode) || null;
    const legacyId = String(row.vaccineCode || row.id || key);
    const projected = {
      ...row,
      // Keep the normalized primary key for joins such as VaccineSelection.
      // `id` remains the legacy public vaccine code expected by the old Web.
      normalizedId: String(row.id || key),
      id: legacyId,
      vaccineId: legacyId,
      programType: override?.programType || row.programType,
      feeType: override?.feeType || (row.programType === "national_immunization_program" ? "free" : "paid"),
      regionalOverride: override,
      doses: (Array.isArray(row.doses) ? row.doses : []).map((dose: any) => ({
        ...dose,
        vaccineId: legacyId,
        doseLabel: dose.doseLabel || `第${dose.doseNumber}剂`,
      })),
    };
    byKey.set(key, projected);
    return projected;
  });
  const national = vaccines.filter((row) => row.programType === "national_immunization_program");
  const provincial = vaccines.filter((row) => row.programType === "provincial_immunization_program");
  const nonProgram = vaccines.filter((row) => row.programType === "non_program");
  const idByRaw = new Map(rows.map((row) => [String(row.id || row.vaccineCode), String(row.vaccineCode || row.id)]));
  const schedule = (Array.isArray(source.schedule) ? source.schedule : []).map((entry: any) => ({
    ...entry,
    vaccineId: idByRaw.get(String(entry.vaccineId)) || entry.vaccineId,
  }));
  return {
    vaccines,
    national,
    provincial,
    nonProgram,
    schedule,
    strategyGroups: Array.isArray(source.strategyGroups) ? source.strategyGroups : [],
    engineRules: Array.isArray(source.engineRules) ? source.engineRules : [],
    dataRelease: source.dataRelease ?? null,
  };
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
  const vaccineRef = String(body.vaccineId || body.vaccineCode || body.name || "").trim();
  const code = String(body.vaccineCode || body.vaccineId || body.name || "").trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vaccineRef);
  const isCompleted = body.isCompleted !== false;
  const scheduledDate = String(
    body.scheduledDate || body.completedDate || body.administeredDate || new Date().toISOString().slice(0, 10),
  ).trim();
  const completedDate = isCompleted
    ? String(body.completedDate || body.administeredDate || scheduledDate).trim()
    : null;

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
    ...(isUuid ? { vaccineId: vaccineRef } : {}),
    doseNumber: parseDoseNumber(body.doseNumber ?? body.dose),
    legacyName: body.name ? String(body.name).trim() : null,
    legacyDose: body.dose ? String(body.dose).trim() : null,
    administeredDate: isCompleted ? (completedDate || scheduledDate) : scheduledDate,
    scheduledDate,
    completedDate,
    isCompleted,
    clinic,
    batchNumber,
    notes,
  };
}

export function fromGrowDeskVaccineRecord(rec: GrowDeskVaccineRecord): LegacyVaccineRecord {
  const doseNum = rec.doseNumber ?? parseDoseNumber(rec.legacyDose || rec.notes);
  const dose = rec.legacyDose || `第${doseNum}剂`;
  const isCompleted = rec.isCompleted !== undefined ? rec.isCompleted : rec.completedDate === null ? false : true;
  const scheduledDate = rec.scheduledDate || rec.administeredDate;
  const completedDate = isCompleted ? (rec.completedDate || rec.administeredDate) : null;

  return {
    id: rec.id,
    babyId: rec.babyId,
    name: rec.legacyName || rec.vaccineCode,
    vaccineId: rec.vaccineCode,
    dose,
    scheduledDate,
    completedDate,
    isCompleted,
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

    // The legacy seed flattened these nested source fields into the Vaccine
    // row. Keep both representations available: the nested values are the
    // source of truth, while the aliases are still consumed by the old Web
    // UI and its API response shape.
    const catchUpSupported = v.catchUp?.supported ?? false;
    const catchUpRules = Array.isArray(v.catchUp?.rules) ? v.catchUp.rules : [];
    const sourceRefs = Array.isArray(v.sourceRefs) ? v.sourceRefs : [];
    const product = v.product && typeof v.product === "object" ? v.product : null;

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
      // Preserve every source-level field so adding a knowledge field does
      // not silently make it disappear at the Web compatibility boundary.
      ...v,
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
      catchUp: v.catchUp ?? null,
      catchUpSupported,
      catchUpRules,
      substitutionRules: v.substitutionRules || null,
      contraindications: v.contraindications || null,
      precautions: v.precautions || null,
      specialPopulations: v.specialPopulations || null,
      regionalOverrides,
      regimenOptions: v.regimenOptions || null,
      notes: v.notes || null,
      targetPopulation: v.targetPopulation ?? null,
      policyEffectiveDate: v.policyEffectiveDate ?? null,
      policyVersion: v.policyVersion ?? null,
      routineHealthyChildOption: v.routineHealthyChildOption ?? true,
      manualReviewRequired: v.manualReviewRequired ?? false,
      marketStatus: v.marketStatus ?? null,
      product,
      productBrandName: product?.brandName ?? null,
      productManufacturer: product?.manufacturer ?? null,
      productApprovalNumber: product?.approvalNumber ?? null,
      jiangsuNotes: v.jiangsuNotes ?? null,
      suzhouNotes: v.suzhouNotes ?? null,
      simultaneousVaccination: v.simultaneousVaccination ?? null,
      sourceRefsJson: sourceRefs,
      doses: doses.map((d: any) => ({
        // Keep any future source fields and expose the legacy seed's parsed
        // sourceRefsJson alias alongside the original sourceRefs array.
        ...d,
        doseNumber: d.doseNumber,
        doseLabel: d.doseLabel || `第${d.doseNumber}剂`,
        recommendedAgeMonths: d.recommendedAgeMonths ?? null,
        minimumAgeDays: d.minimumAgeDays ?? null,
        maximumAgeDays: d.maximumAgeDays ?? null,
        recommendedAgeMaxMonths: d.recommendedAgeMaxMonths ?? null,
        minimumIntervalDaysFromPrevious: d.minimumIntervalDaysFromPrevious ?? null,
        maximumIntervalDaysFromPrevious: d.maximumIntervalDaysFromPrevious ?? null,
        route: d.route ?? null,
        site: d.site ?? null,
        doseVolumeMl: d.doseVolumeMl ?? null,
        notes: d.notes ?? null,
        sourceRefsJson: Array.isArray(d.sourceRefs) ? d.sourceRefs : [],
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

type LegacyVaccineResponse = Record<string, unknown>;
type VaccineSourceRow = Record<string, any>;
type SavedVaccineSelection = {
  selected?: boolean;
  completed?: boolean;
  id?: string;
  updatedAt?: string;
};

const staticVaccineData = vaccineDataset as {
  datasetMeta?: Record<string, any>;
  vaccines?: VaccineSourceRow[];
  vaccineStrategyTemplates?: VaccineSourceRow[];
  vaccineSchedule?: VaccineSourceRow[];
  optionalVaccineTimeline?: VaccineSourceRow[];
  scheduleEngineRules?: VaccineSourceRow[];
};

const staticSources = (sourcesDataset.sources as VaccineSourceRow[]);

function sourceArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sourceRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function legacyVaccineDose(vaccine: VaccineSourceRow, dose: VaccineSourceRow, id: string, legacyVaccineRowId: string): LegacyVaccineResponse {
  return {
    id,
    vaccineId: legacyVaccineRowId,
    doseNumber: dose.doseNumber,
    doseLabel: dose.doseLabel ?? `第${dose.doseNumber}剂`,
    recommendedAgeMonths: dose.recommendedAgeMonths ?? null,
    minimumAgeDays: dose.minimumAgeDays ?? null,
    maximumAgeDays: dose.maximumAgeDays ?? null,
    recommendedAgeMaxMonths: dose.recommendedAgeMaxMonths ?? null,
    minimumIntervalDaysFromPrevious: dose.minimumIntervalDaysFromPrevious ?? null,
    maximumIntervalDaysFromPrevious: dose.maximumIntervalDaysFromPrevious ?? null,
    route: dose.route ?? null,
    site: dose.site ?? null,
    doseVolumeMl: dose.doseVolumeMl ?? null,
    notes: dose.notes ?? null,
    sourceRefsJson: sourceArray(dose.sourceRefs),
  };
}

function projectLegacyVaccine(vaccine: VaccineSourceRow, regionCode: string, createdAt: string): LegacyVaccineResponse {
  const canonical = sourceRecord(vaccine);
  const naturalId = String(canonical.id);
  const regionalOverrides = sourceArray(canonical.regionalProgramOverrides).map(sourceRecord);
  const appliedOverride = regionalOverrides.find((item) => item.regionCode === regionCode);
  const sourceDoses = sourceArray(canonical.doses).map(sourceRecord);
  const legacyId = legacyVaccineId(canonical) ?? naturalId;
  const product = sourceRecord(canonical.product);
  const projected: LegacyVaccineResponse = {
    id: legacyId,
    vaccineId: naturalId,
    name: canonical.name,
    shortName: canonical.shortName ?? null,
    englishName: canonical.englishName ?? null,
    programType: appliedOverride?.programType ?? canonical.programType,
    legacyLabel: canonical.legacyLabel ?? null,
    sexRestriction: canonical.sexRestriction ?? "all",
    chinaNational: canonical.chinaNational ?? false,
    diseases: sourceArray(canonical.diseases),
    targetPopulation: canonical.targetPopulation ?? null,
    policyEffectiveDate: canonical.policyEffectiveDate ?? null,
    policyVersion: canonical.policyVersion ?? null,
    routineHealthyChildOption: canonical.routineHealthyChildOption ?? true,
    manualReviewRequired: canonical.manualReviewRequired ?? false,
    marketStatus: canonical.marketStatus ?? null,
    productBrandName: product.brandName ?? null,
    productManufacturer: product.manufacturer ?? null,
    productApprovalNumber: product.approvalNumber ?? null,
    jiangsuNotes: canonical.jiangsuNotes ?? null,
    suzhouNotes: canonical.suzhouNotes ?? null,
    catchUpSupported: sourceRecord(canonical.catchUp).supported ?? false,
    catchUpRules: sourceArray(sourceRecord(canonical.catchUp).rules),
    simultaneousVaccination: canonical.simultaneousVaccination ?? null,
    substitutionRules: sourceArray(canonical.substitutionRules),
    contraindications: sourceArray(canonical.contraindications),
    precautions: sourceArray(canonical.precautions),
    specialPopulations: sourceArray(canonical.specialPopulations),
    regionalOverrides,
    regimenOptions: sourceArray(canonical.regimenOptions),
    sourceRefsJson: sourceArray(canonical.sourceRefs),
    createdAt,
    doses: sourceDoses.map((dose) => legacyVaccineDose(
      canonical,
      dose,
      legacyVaccineDoseId(canonical, dose) ?? `${legacyId}:${dose.doseNumber}`,
      legacyId,
    )),
  };
  if (appliedOverride) {
    projected.feeType = appliedOverride.feeType ?? null;
    projected.regionalOverride = appliedOverride;
  }
  return projected;
}

function projectLegacySchedule(regionCode: string): LegacyVaccineResponse[] {
  void regionCode;
  const rows: Array<LegacyVaccineResponse & { insertionIndex: number }> = [];
  let insertionIndex = 0;
  for (const entryValue of sourceArray(staticVaccineData.vaccineSchedule)) {
    const entry = sourceRecord(entryValue);
    for (const itemValue of sourceArray(entry.items)) {
      const item = sourceRecord(itemValue);
      rows.push({
        id: legacyReferenceId("VaccineScheduleEntry", insertionIndex),
        ageMonths: entry.ageMonths ?? null,
        ageDays: null,
        ageLabel: null,
        vaccineId: item.vaccineId,
        doseNumber: item.doseNumber ?? 1,
        priority: item.priority ?? "routine",
        isOptional: false,
        action: null,
        selectionGroup: null,
        notes: null,
        sourceRefsJson: sourceArray(item.sourceRefs),
        insertionIndex,
      });
      insertionIndex += 1;
    }
  }
  for (const entryValue of sourceArray(staticVaccineData.optionalVaccineTimeline)) {
    const entry = sourceRecord(entryValue);
    for (const itemValue of sourceArray(entry.items)) {
      const item = sourceRecord(itemValue);
      rows.push({
        id: legacyReferenceId("VaccineScheduleEntry", insertionIndex),
        ageMonths: entry.ageMonths ?? null,
        ageDays: entry.ageDays ?? null,
        ageLabel: entry.ageLabel ?? null,
        vaccineId: item.vaccineId,
        // The legacy seed intentionally inserted one row per optional item.
        doseNumber: 1,
        priority: "optional",
        isOptional: true,
        action: item.action ?? null,
        selectionGroup: item.selectionGroup ?? null,
        notes: null,
        sourceRefsJson: sourceArray(item.sourceRefs),
        insertionIndex,
      });
      insertionIndex += 1;
    }
  }
  return rows
    .sort((left, right) => {
      const ageLeft = left.ageMonths === null ? Number.NEGATIVE_INFINITY : Number(left.ageMonths);
      const ageRight = right.ageMonths === null ? Number.NEGATIVE_INFINITY : Number(right.ageMonths);
      return ageLeft - ageRight || Number(left.doseNumber) - Number(right.doseNumber) || left.insertionIndex - right.insertionIndex;
    })
    .map(({ insertionIndex: _insertionIndex, ...row }) => row);
}

/**
 * Project the complete static vaccine catalogue back to the old Prisma DTO.
 * The extended source projection remains available through loadFullVaccineKnowledge;
 * only the default Web representation should call this function.
 */
export function projectLegacyVaccineKnowledge(fullKnowledge: ReturnType<typeof loadFullVaccineKnowledge>, regionCode = "CN-JS") {
  const createdAt = legacyFixtureCreatedAt();
  const rawById = new Map(sourceArray(staticVaccineData.vaccines).map((row) => [String(sourceRecord(row).id), sourceRecord(row)]));
  const projectGroup = (rows: unknown[]) => {
    const present = new Set(rows.map((row) => {
      const value = sourceRecord(row);
      return String(value.vaccineId ?? value.vaccineCode ?? value.id);
    }));
    // The normalized API sorts by vaccineCode for stable pagination. The old
    // Web exposed the versioned dataset order, so restore that order after
    // confirming which catalogue rows are actually present upstream.
    return sourceArray(staticVaccineData.vaccines)
      .map(sourceRecord)
      .filter((row) => present.has(String(row.id)))
      .map((row) => projectLegacyVaccine(row, regionCode, createdAt));
  };
  const templates = sourceArray(staticVaccineData.vaccineStrategyTemplates).map(sourceRecord);
  const rules = sourceArray(staticVaccineData.scheduleEngineRules).map(sourceRecord);
  const meta = sourceRecord(sourcesDataset.datasetMeta);
  const dataRelease = {
    id: legacyDataReleaseId(),
    title: meta.title ?? "0–3岁中国婴幼儿育儿数据库",
    asOf: meta.asOf ?? fullKnowledge.dataRelease?.asOf ?? null,
    createdAt,
    sources: staticSources.map((source) => ({
      id: legacySourceRefId(source) ?? source.id,
      sourceId: source.id,
      title: source.title,
      organization: source.organization ?? null,
      year: source.year ?? null,
      publicationDate: source.publicationDate ?? null,
      url: source.url ?? null,
      sourceLevel: source.sourceLevel ?? null,
      sourceType: source.sourceType ?? null,
      accessedDate: source.accessedDate ?? null,
      notes: source.notes ?? null,
      dataReleaseId: legacyDataReleaseId(),
    })),
  };
  return {
    national: projectGroup(fullKnowledge.national),
    nonProgram: projectGroup(fullKnowledge.nonProgram),
    provincial: projectGroup(fullKnowledge.provincial),
    strategyGroups: templates.map((template) => ({
      id: legacyVaccineStrategyGroupId(template) ?? template.id,
      strategyId: template.id,
      name: template.name,
      scope: template.scope ?? null,
      baseProgram: template.baseProgram ?? null,
      optionsJson: sourceArray(template.optionalSelections),
      sourceRefsJson: sourceArray(template.sourceRefs),
    })),
    schedule: projectLegacySchedule(regionCode),
    engineRules: rules.map((rule) => ({
      id: legacyScheduleEngineRuleId(rule) ?? rule.id,
      ruleId: rule.id,
      type: rule.type,
      vaccineIdsJson: sourceArray(rule.vaccineIds),
      description: rule.description ?? "",
      sourceRefsJson: sourceArray(rule.sourceRefs),
    })),
    dataRelease,
  };
}

/** Project persisted old selection rows, preserving the old row shape. */
export function projectLegacyVaccineSelections(
  records: GrowDeskVaccineRecord[],
  savedSelections: Record<string, SavedVaccineSelection> | undefined,
  babyId: string,
  updatedAtFallback?: string,
) {
  const recordByKey = new Map<string, GrowDeskVaccineRecord>();
  for (const record of records) {
    recordByKey.set(`${record.vaccineCode}-${record.doseNumber ?? parseDoseNumber(record.legacyDose || record.notes)}`, record);
  }
  return Object.entries(savedSelections ?? {})
    .map(([key, saved]) => {
      const separator = key.lastIndexOf("-");
      const vaccineId = separator > 0 ? key.slice(0, separator) : key;
      const parsedDose = separator > 0 ? Number(key.slice(separator + 1)) : 1;
      const doseNumber = Number.isInteger(parsedDose) && parsedDose > 0 ? parsedDose : 1;
      const record = recordByKey.get(`${vaccineId}-${doseNumber}`);
      const id = saved.id || (record ? legacyFixtureSiblingId(record.id, 1) : undefined);
      const updatedAt = saved.updatedAt || record?.updatedAt || record?.createdAt || updatedAtFallback;
      const row: LegacyVaccineResponse = {
        ...(id ? { id } : {}),
        babyId,
        vaccineId,
        doseNumber,
        selected: saved.selected ?? true,
        completed: saved.completed ?? false,
        ...(updatedAt ? { updatedAt } : {}),
      };
      return row;
    })
    .sort((left, right) => String(left.vaccineId).localeCompare(String(right.vaccineId)) || Number(left.doseNumber) - Number(right.doseNumber));
}

export function buildVaccineSelections(
  records: GrowDeskVaccineRecord[],
  savedSelections?: Record<string, SavedVaccineSelection>,
  knowledge?: { vaccines?: Array<Record<string, any>> },
): VaccineSelectionItem[] {
  const result: VaccineSelectionItem[] = [];
  const recordMap = new Map<string, GrowDeskVaccineRecord>();

  for (const rec of records) {
    const doseNum = rec.doseNumber ?? parseDoseNumber(rec.legacyDose || rec.notes);
    const key = `${rec.vaccineCode}-${doseNum}`;
    recordMap.set(key, rec);
  }

  const fullKb = knowledge || loadFullVaccineKnowledge();
  const allVaccines = fullKb.vaccines || [];

  for (const v of allVaccines) {
    const doses = Array.isArray(v.doses) && v.doses.length > 0 ? v.doses : [{ doseNumber: 1 }];
    for (const d of doses) {
      const key = `${v.vaccineId}-${d.doseNumber}`;
      const rec =
        recordMap.get(key) ||
        recordMap.get(`${v.name}-${d.doseNumber}`) ||
        (v.shortName ? recordMap.get(`${v.shortName.split("/")[0]}-${d.doseNumber}`) : undefined);
      const saved = savedSelections ? savedSelections[key] : undefined;

      const isCompleted = Boolean((rec && rec.isCompleted !== false) || saved?.completed);
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

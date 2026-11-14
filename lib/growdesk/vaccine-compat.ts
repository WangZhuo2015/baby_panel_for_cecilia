import fs from "node:fs";
import path from "node:path";
import vaccineDataset from "../../data/02_vaccines.json";
import sourcesDataset from "../../data/01_sources.json";
import { matchVaccineProduct, parseVaccineRecordInput, vaccineDoseNumber, vaccineRecordStatus, type VaccineLedgerRecord, type VaccineRecordStatus } from "../vaccine-records";
import { getLocalDateStr, isValidDateStr } from "../date";
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

export type LegacyVaccineRecord = VaccineLedgerRecord;

export interface GrowDeskVaccineRecord {
  id: string;
  babyId: string;
  familyId: string;
  vaccineCode: string;
  vaccineId?: string | null;
  doseNumber?: number | null;
  legacyName?: string | null;
  legacyDose?: string | null;
  recordStatus?: VaccineRecordStatus;
  administeredDate: string | null;
  scheduledDate?: string | null;
  completedDate?: string | null;
  isCompleted?: boolean;
  manufacturer?: string | null;
  clinic: string | null;
  batchNumber: string | null;
  traceCode?: string | null;
  administrationRoute?: string | null;
  injectionSite?: string | null;
  sourceText?: string | null;
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

export function parseDoseNumber(value: unknown): number | null {
  const direct = vaccineDoseNumber(value);
  if (direct !== null) return direct;
  if (typeof value !== "string") return null;
  // Old records carried an explicit ordinal in notes. A batch number or date
  // is not a dose number, and absent notes must not turn into dose one.
  const match = value.match(/第\s*(\d{1,2})\s*剂/u);
  return match ? vaccineDoseNumber(Number(match[1])) : null;
}

export function toGrowDeskVaccineRecordPayload(body: Record<string, unknown>) {
  const input = parseVaccineRecordInput({ ...body, name: body.name ?? body.legacyName ?? body.vaccineCode ?? body.vaccineId });
  const reference = input.vaccineId || (typeof body.vaccineCode === "string" ? body.vaccineCode.trim() : "");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference);
  const catalog = loadFullVaccineKnowledge().vaccines;
  const matched = !reference && !Object.hasOwn(body, "vaccineId") ? matchVaccineProduct(input.name, catalog) : null;
  const knownReference = isUuid || catalog.some(row => row.vaccineId === reference);
  const code = reference || matched?.vaccineId || input.name;
  return {
    vaccineCode: typeof body.vaccineCode === "string" && body.vaccineCode.trim() ? body.vaccineCode.trim() : code,
    vaccineId: input.vaccineId || matched?.vaccineId || (!Object.hasOwn(body, "vaccineId") && knownReference ? reference : null),
    doseNumber: input.doseNumber,
    legacyName: input.name,
    legacyDose: input.dose,
    recordStatus: input.recordStatus,
    administeredDate: input.administeredDate,
    scheduledDate: input.scheduledDate,
    completedDate: input.completedDate,
    isCompleted: input.isCompleted,
    manufacturer: input.manufacturer,
    clinic: input.clinic,
    batchNumber: input.batchNumber,
    traceCode: input.traceCode,
    administrationRoute: input.administrationRoute,
    injectionSite: input.injectionSite,
    sourceText: input.sourceText,
    notes: input.notes,
  };
}

export function fromGrowDeskVaccineRecord(rec: GrowDeskVaccineRecord): LegacyVaccineRecord {
  const doseNumber = rec.doseNumber ?? (!rec.recordStatus ? parseDoseNumber(rec.legacyDose || rec.notes) : null);
  const catalog = loadFullVaccineKnowledge().vaccines;
  const product = rec.vaccineId === null && rec.recordStatus ? null : catalog.find(row => row.vaccineId === rec.vaccineCode)
    || matchVaccineProduct(rec.vaccineCode, catalog)
    || matchVaccineProduct(rec.legacyName || rec.vaccineCode, catalog);
  let recordStatus = vaccineRecordStatus(rec);
  const actual = rec.completedDate || rec.administeredDate || null;
  if (recordStatus === "completed" && (!actual || !isValidDateStr(actual) || actual > getLocalDateStr())) recordStatus = "needs_review";
  if (recordStatus === "planned" && !(rec.scheduledDate || (!rec.recordStatus && rec.administeredDate))) recordStatus = "needs_review";
  const isCompleted = recordStatus === "completed";
  return {
    id: rec.id,
    babyId: rec.babyId,
    name: rec.legacyName || rec.vaccineCode,
    // A free-text vaccineCode is not evidence of a catalogue relationship.
    vaccineId: rec.vaccineId ? (product?.vaccineId || rec.vaccineCode) : product?.vaccineId || null,
    dose: rec.legacyDose || (doseNumber ? `第${doseNumber}剂` : "剂次待核对"),
    doseNumber,
    recordStatus,
    // Only legacy planned DTOs used administeredDate as a transport placeholder.
    administeredDate: recordStatus === "planned" ? null : actual,
    scheduledDate: rec.scheduledDate || (!rec.recordStatus && recordStatus === "planned" ? rec.administeredDate : null),
    completedDate: isCompleted ? actual : null,
    isCompleted,
    manufacturer: rec.manufacturer ?? null,
    clinic: rec.clinic ?? null,
    batchNumber: rec.batchNumber ?? null,
    traceCode: rec.traceCode ?? null,
    administrationRoute: rec.administrationRoute ?? null,
    injectionSite: rec.injectionSite ?? null,
    sourceText: rec.sourceText ?? null,
    notes: rec.notes ?? null,
    version: String(rec.version),
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

/** Completed progress is a projection of verified records, never a writable flag. */
function completedRecordsByKey(records: GrowDeskVaccineRecord[], knowledge?: { vaccines?: Array<Record<string, any>> }) {
  const vaccines = knowledge?.vaccines || loadFullVaccineKnowledge().vaccines;
  const byCode = new Map<string, Record<string, any>>();
  for (const vaccine of vaccines) {
    for (const key of [vaccine.vaccineId, vaccine.vaccineCode, vaccine.id, vaccine.normalizedId]) {
      if (key) byCode.set(String(key), vaccine);
    }
  }
  const result = new Map<string, GrowDeskVaccineRecord>();
  for (const record of records) {
    const projected = fromGrowDeskVaccineRecord(record);
    if (!projected.isCompleted || projected.doseNumber === null) continue;
    if (record.vaccineId === null && record.recordStatus) continue;
    const vaccine = byCode.get(record.vaccineCode)
      || (record.vaccineId ? byCode.get(record.vaccineId) : undefined)
      || matchVaccineProduct(record.legacyName || record.vaccineCode, vaccines);
    const code = vaccine?.vaccineId || vaccine?.vaccineCode || record.vaccineCode;
    const key = `${code}-${projected.doseNumber}`;
    // A later planned/review row must never erase a completed dose.
    if (!result.has(key)) result.set(key, record);
  }
  return result;
}

/** Project legacy rows while preserving their IDs and selection preferences. */
export function projectLegacyVaccineSelections(
  records: GrowDeskVaccineRecord[],
  savedSelections: Record<string, SavedVaccineSelection> | undefined,
  babyId: string,
  updatedAtFallback?: string,
) {
  const recordByKey = completedRecordsByKey(records);
  const keys = new Set([...Object.keys(savedSelections || {}), ...recordByKey.keys()]);
  return [...keys].map(key => {
    const saved = savedSelections?.[key];
    const separator = key.lastIndexOf("-");
    const vaccineId = separator > 0 ? key.slice(0, separator) : key;
    const doseNumber = separator > 0 ? vaccineDoseNumber(Number(key.slice(separator + 1))) : null;
    if (doseNumber === null) return null;
    const record = recordByKey.get(key);
    const id = saved?.id || (record ? legacyFixtureSiblingId(record.id, 1) : undefined);
    const updatedAt = saved?.updatedAt || record?.updatedAt || record?.createdAt || updatedAtFallback;
    return {
      ...(id ? { id } : {}), babyId, vaccineId, doseNumber,
      selected: saved?.selected ?? true,
      completed: Boolean(record),
      ...(updatedAt ? { updatedAt } : {}),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => left.vaccineId.localeCompare(right.vaccineId) || left.doseNumber - right.doseNumber);
}

export function buildVaccineSelections(
  records: GrowDeskVaccineRecord[],
  savedSelections?: Record<string, SavedVaccineSelection>,
  knowledge?: { vaccines?: Array<Record<string, any>> },
): VaccineSelectionItem[] {
  const fullKb = knowledge || loadFullVaccineKnowledge();
  const recordMap = completedRecordsByKey(records, fullKb);
  const result: VaccineSelectionItem[] = [];
  for (const vaccine of fullKb.vaccines || []) {
    const code = vaccine.vaccineId || vaccine.vaccineCode || vaccine.id;
    const doses = Array.isArray(vaccine.doses) ? vaccine.doses : [];
    for (const dose of doses) {
      const key = `${code}-${dose.doseNumber}`;
      const record = recordMap.get(key);
      const saved = savedSelections?.[key];
      result.push({
        vaccineId: code,
        doseNumber: dose.doseNumber,
        selected: saved?.selected ?? Boolean(record),
        completed: Boolean(record),
        recordId: record?.id ?? null,
      });
    }
  }
  return result;
}

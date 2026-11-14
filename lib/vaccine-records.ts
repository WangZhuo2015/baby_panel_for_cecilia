import { getLocalDateStr, isValidDateStr } from "./date";

/** A record describes one administration, one appointment, or unverified source text. */
export type VaccineRecordStatus = "completed" | "planned" | "needs_review";

export interface VaccineRecordInput {
  name: string;
  vaccineId: string | null;
  dose: string;
  doseNumber: number | null;
  recordStatus: VaccineRecordStatus;
  administeredDate: string | null;
  scheduledDate: string | null;
  completedDate: string | null;
  isCompleted: boolean;
  manufacturer: string | null;
  clinic: string | null;
  batchNumber: string | null;
  traceCode: string | null;
  administrationRoute: string | null;
  injectionSite: string | null;
  sourceText: string | null;
  notes: string | null;
}

export interface VaccineLedgerRecord extends VaccineRecordInput {
  id: string;
  babyId: string;
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoredVaccineRecord extends Omit<Partial<VaccineRecordInput>, "recordStatus"> {
  id: string;
  babyId: string;
  name: string;
  recordStatus?: string | null;
  version?: string | number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/** Read old rows without inventing missing dates, ordinals or catalogue links. */
export function projectVaccineLedgerRecord(record: StoredVaccineRecord): VaccineLedgerRecord {
  let recordStatus = vaccineRecordStatus(record);
  const actual = record.administeredDate || record.completedDate || null;
  if (recordStatus === "completed" && (!actual || !isValidDateStr(actual) || actual > getLocalDateStr())) recordStatus = "needs_review";
  if (recordStatus === "planned" && !record.scheduledDate) recordStatus = "needs_review";
  const doseNumber = record.doseNumber ?? (!record.recordStatus ? vaccineDoseNumber(record.dose) : null);
  return {
    id: record.id, babyId: record.babyId, name: record.name,
    vaccineId: record.vaccineId ?? null,
    dose: record.dose || (doseNumber ? `第${doseNumber}剂` : "剂次待核对"),
    doseNumber, recordStatus,
    administeredDate: recordStatus === "planned" ? null : actual,
    scheduledDate: record.scheduledDate ?? null,
    completedDate: recordStatus === "completed" ? actual : null,
    isCompleted: recordStatus === "completed",
    manufacturer: record.manufacturer ?? null,
    clinic: record.clinic ?? null,
    batchNumber: record.batchNumber ?? null,
    traceCode: record.traceCode ?? null,
    administrationRoute: record.administrationRoute ?? null,
    injectionSite: record.injectionSite ?? null,
    sourceText: record.sourceText ?? null,
    notes: record.notes ?? null,
    version: String(record.version ?? 1),
    ...(record.createdAt ? { createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt } : {}),
  };
}

export class VaccineRecordValidationError extends Error {
  readonly status = 400;
  readonly code = "INVALID_VACCINE_RECORD";
}

const statuses = new Set<VaccineRecordStatus>(["completed", "planned", "needs_review"]);

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new VaccineRecordValidationError(`${label}必须为不超过 ${max} 个字符的文本`);
  }
  return value.trim() || null;
}

function optionalDate(value: unknown, label: string): string | null {
  const result = optionalText(value, label, 10);
  if (result && !isValidDateStr(result)) {
    throw new VaccineRecordValidationError(`${label}必须是完整有效的 YYYY-MM-DD 日期；无法确认的原文请保存在待核对内容中`);
  }
  return result;
}

/** Only an explicit ordinal is parsed. Missing/ambiguous doses stay unknown. */
export function vaccineDoseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:第\s*)?(\d{1,2})\s*(?:剂|针)?$/u);
  if (!match) return null;
  const dose = Number(match[1]);
  return dose >= 1 && dose <= 12 ? dose : null;
}

export function vaccineRecordStatus(record: {
  recordStatus?: unknown;
  isCompleted?: unknown;
  completedDate?: unknown;
  administeredDate?: unknown;
  scheduledDate?: unknown;
}): VaccineRecordStatus {
  if (statuses.has(record.recordStatus as VaccineRecordStatus)) return record.recordStatus as VaccineRecordStatus;
  if (record.isCompleted === true || (record.isCompleted === undefined && (record.completedDate || record.administeredDate))) return "completed";
  if (record.scheduledDate) return "planned";
  return "needs_review";
}

export function parseVaccineRecordInput(body: Record<string, unknown>, today = getLocalDateStr()): VaccineRecordInput {
  const name = optionalText(body.name ?? body.legacyName ?? body.vaccineCode, "疫苗名称", 200);
  if (!name) throw new VaccineRecordValidationError("请填写疫苗本上的名称，或选择具体产品");
  if (body.recordStatus !== undefined && !statuses.has(body.recordStatus as VaccineRecordStatus)) {
    throw new VaccineRecordValidationError("记录状态必须为已接种、预约或待核对");
  }
  if (body.isCompleted !== undefined && typeof body.isCompleted !== "boolean") {
    throw new VaccineRecordValidationError("isCompleted 必须为布尔值");
  }
  const status = body.recordStatus as VaccineRecordStatus | undefined
    ?? (body.isCompleted === true ? "completed"
      : body.isCompleted === false ? (body.scheduledDate ? "planned" : "needs_review")
      : body.completedDate || body.administeredDate ? "completed"
      : body.scheduledDate ? "planned" : "needs_review");
  if (body.recordStatus !== undefined && body.isCompleted !== undefined && body.isCompleted !== (status === "completed")) {
    throw new VaccineRecordValidationError("接种状态与记录类型不一致");
  }
  const scheduledDate = optionalDate(body.scheduledDate, "预约日期");
  const suppliedCompleted = optionalDate(body.completedDate, "实际接种日期");
  const suppliedAdministered = optionalDate(body.administeredDate, "实际接种日期");
  if (suppliedCompleted && suppliedAdministered && suppliedCompleted !== suppliedAdministered) {
    throw new VaccineRecordValidationError("两处实际接种日期不一致，请核对疫苗本");
  }
  const actualDate = suppliedCompleted || suppliedAdministered;
  if (status === "completed" && !actualDate) {
    throw new VaccineRecordValidationError("已接种记录必须填写实际接种日期；日期不清楚时请保存为待核对");
  }
  if (status === "completed" && actualDate! > today) {
    throw new VaccineRecordValidationError("实际接种日期不能晚于今天；预约请保存为计划，其他日期请先核对用途");
  }
  if (status === "planned" && !scheduledDate) throw new VaccineRecordValidationError("预约记录必须填写预约日期");
  if (status === "planned" && actualDate) throw new VaccineRecordValidationError("预约不能同时填写实际接种日期");
  const rawDose = optionalText(body.dose ?? body.legacyDose, "疫苗本剂次", 50);
  let doseNumber: number | null;
  if (body.doseNumber === undefined) doseNumber = vaccineDoseNumber(rawDose);
  else if (body.doseNumber === null || body.doseNumber === "") doseNumber = null;
  else {
    doseNumber = vaccineDoseNumber(body.doseNumber);
    if (typeof body.doseNumber !== "number" || doseNumber === null) {
      throw new VaccineRecordValidationError("剂次必须为 1–12 的整数；无法确认时留空");
    }
  }
  const writtenDose = vaccineDoseNumber(rawDose);
  if (writtenDose && doseNumber && writtenDose !== doseNumber) throw new VaccineRecordValidationError("疫苗本剂次与所选剂次不一致");
  return {
    name,
    vaccineId: optionalText(body.vaccineId, "疫苗产品", 200),
    dose: rawDose || (doseNumber ? `第${doseNumber}剂` : "剂次待核对"),
    doseNumber,
    recordStatus: status,
    administeredDate: status === "planned" ? null : actualDate,
    scheduledDate,
    completedDate: status === "completed" ? actualDate : null,
    isCompleted: status === "completed",
    manufacturer: optionalText(body.manufacturer, "生产企业", 200),
    clinic: optionalText(body.clinic, "接种单位", 200),
    batchNumber: optionalText(body.batchNumber, "批号", 100),
    traceCode: optionalText(body.traceCode, "电子追溯码", 200),
    administrationRoute: optionalText(body.administrationRoute, "接种途径", 50),
    injectionSite: optionalText(body.injectionSite, "接种部位", 100),
    sourceText: optionalText(body.sourceText, "疫苗本原文", 4000),
    notes: optionalText(body.notes, "备注", 4000),
  };
}

export interface VaccineCatalogIdentity {
  id?: string;
  vaccineId?: string;
  vaccineCode?: string;
  normalizedId?: string;
  name: string;
  shortName?: string | null;
  englishName?: string | null;
}

const aliases: Record<string, string[]> = {
  vac_dtap_ipv_hib_pentaxim: ["潘太欣", "PENTAXIM"],
  vac_hib_acthib: ["安尔宝", "Act-HIB"],
  vac_rotavirus5: ["乐儿德", "RotaTeq"],
  vac_mcv4_crm197: ["曼海欣"],
};

function identityKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
}

/** Full catalogue names and explicit brands only. A unique short name does not establish product identity. */
export function matchVaccineProduct<T extends VaccineCatalogIdentity>(name: string, vaccines: T[]): T | null {
  const key = identityKey(name);
  if (!key) return null;
  const matches = vaccines.filter(vaccine => {
    const code = vaccine.vaccineCode || vaccine.vaccineId || vaccine.id || "";
    const names = [vaccine.name, ...(aliases[code] || [])];
    return names.some(value => typeof value === "string" && value.trim() && identityKey(value) === key);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function vaccineRecordDate(record: Pick<VaccineRecordInput, "recordStatus" | "completedDate" | "administeredDate" | "scheduledDate">): string | null {
  return record.recordStatus === "completed" ? (record.completedDate || record.administeredDate)
    : record.recordStatus === "planned" ? record.scheduledDate : null;
}

/** Keep catalogue reference filtering separate from the baby's actual history. */
export function showVaccineReference(vaccine: { sexRestriction?: string | null; routineHealthyChildOption?: boolean | null }, gender?: string | null): boolean {
  if (vaccine.routineHealthyChildOption === false) return false;
  return !["female", "male"].includes(vaccine.sexRestriction ?? "") || vaccine.sexRestriction === gender;
}

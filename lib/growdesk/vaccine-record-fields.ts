import { BridgeError, calendarDate } from "./bridge-protocol";

export interface VaccineRecordFields {
  name: string;
  vaccineId: string | null;
  dose: string | null;
  doseNumber: number | null;
  scheduledDate: string | null;
  completedDate: string | null;
  isCompleted: boolean;
  clinic: string | null;
  batchNumber: string | null;
  manufacturer: string | null;
  productName: string | null;
  traceabilityCode: string | null;
  injectionSite: string | null;
  notes: string | null;
}

const textLimits = {
  clinic: 200, batchNumber: 100, manufacturer: 200, productName: 200,
  traceabilityCode: 200, injectionSite: 100, notes: 1000,
} as const;

function invalid(message: string): never {
  throw new BridgeError(400, "INVALID_VACCINE_RECORD", message);
}

function nullableText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) invalid(`${field} 必须为不超过 ${max} 个字符的文本`);
  return value.trim() || null;
}

/** Only a dose label or an explicitly tagged old dose may become a number. */
export function parseDoseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
  if (typeof value !== "string") return null;
  const tagged = value.match(/(?:^|\()剂次:\s*([^()]+)\)?$/);
  const label = tagged ? tagged[1].trim() : value.trim();
  const match = label.match(/^(?:第\s*)?(\d{1,2})\s*(?:剂(?:次)?|针)?$/);
  const ordinals = [...label.matchAll(/第\s*(\d{1,2})\s*剂/g)];
  const explicitLegacyDose = ordinals.length === 1 && /^第/.test(label) && !/待|未知|不确定|可能|或|下次|下一|计划|预约|未接种|建议/.test(label)
    ? Number(ordinals[0][1]) : null;
  const dose = match ? Number(match[1]) : explicitLegacyDose;
  return dose !== null && dose >= 1 && dose <= 12 ? dose : null;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  try { return calendarDate(value); } catch { return invalid(`${label} 必须是有效的 YYYY-MM-DD 日期`); }
}

/** Validate the final record, preserving unknown facts and requiring an actual date on completion. */
export function vaccineRecordFields(body: Record<string, unknown>, current?: Partial<VaccineRecordFields>): VaccineRecordFields {
  const merged: Record<string, unknown> = { ...current, ...body };
  const name = nullableText(merged.name, "疫苗名称", 200);
  if (!name) invalid("请填写疫苗本上的疫苗名称");
  const vaccineId = nullableText(merged.vaccineId, "疫苗目录关联", 128);
  const isCompleted = merged.isCompleted === undefined ? true : merged.isCompleted;
  if (typeof isCompleted !== "boolean") invalid("isCompleted 必须为布尔值");
  const scheduledDate = optionalDate(merged.scheduledDate, "计划接种日期");
  if (!isCompleted && !scheduledDate) invalid("请填写预约/计划接种日期");
  if (isCompleted && current?.isCompleted === false && body.completedDate === undefined && body.administeredDate === undefined) {
    invalid("预约转为已接种时，请明确填写实际接种日期");
  }
  const suppliedActual = body.completedDate !== undefined ? body.completedDate
    : body.administeredDate !== undefined ? body.administeredDate : merged.completedDate;
  const actualDate = optionalDate(suppliedActual, "实际接种日期");
  if (isCompleted && !actualDate) invalid("请明确填写实际接种日期；计划日期不能代替接种事实");
  if (body.administeredDate !== undefined && body.completedDate !== undefined && isCompleted &&
      optionalDate(body.administeredDate, "实际接种日期") !== actualDate) invalid("实际接种日期字段不一致");
  if (!isCompleted && body.completedDate !== undefined && body.completedDate !== null && body.completedDate !== "") {
    invalid("预约记录不能填写已接种日期");
  }

  let dose = nullableText(merged.dose, "剂次原文", 100);
  let doseNumber: number | null;
  if (body.doseNumber !== undefined) {
    if (body.doseNumber === null || body.doseNumber === "") doseNumber = null;
    else {
      doseNumber = parseDoseNumber(body.doseNumber);
      if (typeof body.doseNumber !== "number" || doseNumber === null) invalid("doseNumber 必须为 1-12 的整数，未知时留空");
    }
  } else if (body.dose !== undefined) {
    doseNumber = parseDoseNumber(dose);
  } else {
    doseNumber = parseDoseNumber(merged.doseNumber) ?? parseDoseNumber(dose);
  }
  if (doseNumber !== null && !dose) dose = `第${doseNumber}剂`;
  const labelNumber = parseDoseNumber(dose);
  if (doseNumber !== null && labelNumber !== null && doseNumber !== labelNumber) invalid("剂次数字与剂次原文不一致，请核对疫苗本");

  const details = Object.fromEntries(Object.entries(textLimits).map(([key, limit]) => [key, nullableText(merged[key], key, limit)])) as Pick<VaccineRecordFields, keyof typeof textLimits>;
  return { name, vaccineId, dose, doseNumber, scheduledDate, completedDate: isCompleted ? actualDate : null, isCompleted, ...details };
}

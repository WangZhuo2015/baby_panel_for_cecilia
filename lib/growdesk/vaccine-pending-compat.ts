import { randomUUID } from "node:crypto";
import { isValidDateStr } from "@/lib/date";
import { BridgeError } from "./bridge-protocol";
import { readGrowDeskFoodPlan, type GrowDeskFoodPlanState } from "./food-plan-state";

export interface LegacyPendingVaccine {
  id: string;
  babyId: string;
  vaccineId?: string;
  name: string;
  dose: string;
  doseNumber: number;
  scheduledDate: string;
  completedDate: null;
  isCompleted: false;
  createdAt: string;
  updatedAt: string;
}

export type PendingPlanEnvelope = GrowDeskFoodPlanState;

function invalid(message: string, status = 502): never {
  throw new BridgeError(status, status === 400 ? "INVALID_VACCINE_RECORD" : "UPSTREAM_INVALID_RESPONSE", message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}格式无效`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, status = 502): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) invalid(`${label}无效`, status);
  return value.trim();
}

export function readPendingPlan(value: unknown, babyId: string): PendingPlanEnvelope {
  return readGrowDeskFoodPlan({ ok: true, status: 200, data: value }, babyId);
}

function pendingFields(raw: Record<string, unknown>, babyId: string, status: number): LegacyPendingVaccine {
  if (raw.babyId !== babyId) throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "待接种记录宝宝范围不一致");
  const scheduledDate = text(raw.scheduledDate, "scheduledDate", 10, status);
  if (!isValidDateStr(scheduledDate)) invalid("scheduledDate 必须是有效的 YYYY-MM-DD 日期", status);
  const doseNumber = raw.doseNumber;
  if (!Number.isInteger(doseNumber) || Number(doseNumber) < 1 || Number(doseNumber) > 12) invalid("doseNumber 必须为 1-12 的整数", status);
  if (raw.isCompleted !== false || raw.completedDate !== null) invalid("待接种记录完成状态无效", status);
  const createdAt = text(raw.createdAt, "createdAt", 64, status);
  const updatedAt = text(raw.updatedAt, "updatedAt", 64, status);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) invalid("待接种记录时间无效", status);
  const vaccineId = raw.vaccineId === undefined ? undefined : text(raw.vaccineId, "vaccineId", 200, status);
  return {
    id: text(raw.id, "id", 200, status), babyId, ...(vaccineId ? { vaccineId } : {}),
    name: text(raw.name, "name", 200, status), dose: text(raw.dose, "dose", 50, status),
    doseNumber: Number(doseNumber), scheduledDate, completedDate: null, isCompleted: false,
    createdAt, updatedAt,
  };
}

export function readLegacyPendingVaccines(plan: PendingPlanEnvelope): LegacyPendingVaccine[] {
  const raw = plan.planData.legacyPendingVaccines;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) invalid("legacyPendingVaccines 必须是数组");
  const seen = new Set<string>();
  return raw.map(value => {
    const item = pendingFields(object(value, "待接种记录"), plan.babyId, 502);
    if (seen.has(item.id)) invalid("待接种记录 ID 重复");
    seen.add(item.id);
    return item;
  });
}

export function createLegacyPendingVaccine(body: Record<string, unknown>, babyId: string, now = new Date()): LegacyPendingVaccine {
  const dose = typeof body.dose === "string" && body.dose.trim() ? body.dose.trim() : "第1剂";
  const match = dose.match(/\d+/);
  const doseNumber = body.doseNumber ?? (match ? Number(match[0]) : 1);
  const timestamp = now.toISOString();
  return pendingFields({
    id: typeof body.clientId === "string" && body.clientId.trim() ? body.clientId.trim() : randomUUID(),
    babyId, vaccineId: body.vaccineId, name: body.name, dose, doseNumber,
    scheduledDate: body.scheduledDate, completedDate: null, isCompleted: false,
    createdAt: timestamp, updatedAt: timestamp,
  }, babyId, 400);
}

export function appendLegacyPendingVaccine(plan: PendingPlanEnvelope, item: LegacyPendingVaccine): Record<string, unknown> {
  return mergeLegacyPendingVaccine(plan, item).planData;
}

export function mergeLegacyPendingVaccine(
  plan: PendingPlanEnvelope,
  item: LegacyPendingVaccine,
): { item: LegacyPendingVaccine; planData: Record<string, unknown>; created: boolean } {
  const current = readLegacyPendingVaccines(plan);
  const existing = current.find(value => value.id === item.id);
  if (existing) {
    const same = existing.babyId === item.babyId && existing.vaccineId === item.vaccineId
      && existing.name === item.name && existing.dose === item.dose
      && existing.doseNumber === item.doseNumber && existing.scheduledDate === item.scheduledDate;
    if (!same) throw new BridgeError(409, "IDEMPOTENCY_KEY_REUSED", "待接种记录 ID 已用于其他内容");
    return { item: existing, planData: plan.planData, created: false };
  }
  return { item, planData: { ...plan.planData, legacyPendingVaccines: [...current, item] }, created: true };
}

export function removeLegacyPendingVaccine(plan: PendingPlanEnvelope, id: string): { found: boolean; planData: Record<string, unknown> } {
  const current = readLegacyPendingVaccines(plan);
  const remaining = current.filter(item => item.id !== id);
  return { found: remaining.length !== current.length, planData: { ...plan.planData, legacyPendingVaccines: remaining } };
}

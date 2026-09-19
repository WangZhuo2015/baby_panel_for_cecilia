import { addMonths, diffCalendarDays, isValidDateStr } from "@/lib/date";
import type { NotificationItem } from "@/app/api/notifications/route";
import {
  BridgeError,
  pathId,
  requireData,
  type BridgeFetch,
  type BridgeResult,
} from "./bridge-protocol";
import { dayBoundsInTimeZone } from "./record-list";
import { fetchCompleteList } from "./paged-list";
import { fromGrowDeskNotification } from "./notifications";

type JsonObject = Record<string, unknown>;

export interface GrowDeskNotificationScope {
  babyId: string;
  familyId: string;
  birthDate: string;
}

interface FamilyMember {
  userId: string;
  familyId: string;
  displayName: string;
}

export interface FamilyClock {
  date: string;
  timeZone: string;
  startMs: number;
  endMs: number;
}

interface CanonicalNotification {
  id: string;
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  data?: JsonObject | null;
  createdAt: string;
}

interface VaccineScheduleItem {
  vaccineCode: string;
  name: string;
  recommendedAgeMonths: number;
  doseNumber: number;
  mandatory?: boolean;
}

interface VaccineRecord extends JsonObject {
  id: string;
  babyId: string;
  familyId: string;
  vaccineCode: string;
  administeredDate: string;
  notes?: string | null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(message: string): never {
  throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", message);
}

function stringField(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    invalidResponse(`GrowDesk 返回的 ${field} 无效`);
  }
  return value;
}

function instantField(value: unknown, field: string): number {
  const text = stringField(value, field);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) invalidResponse(`GrowDesk 返回的 ${field} 时间无效`);
  return ms;
}

function dateField(value: unknown, field: string): string {
  const text = stringField(value, field);
  if (!isValidDateStr(text)) invalidResponse(`GrowDesk 返回的 ${field} 日期无效`);
  return text;
}

function arrayData<T>(result: BridgeResult<T[]>, label: string): T[] {
  const data = requireData(result);
  if (!Array.isArray(data)) invalidResponse(`GrowDesk 返回的 ${label} 不是数组`);
  return data;
}

async function fetchArray<T>(
  fetchApi: BridgeFetch,
  token: string,
  pathname: string,
  label: string,
): Promise<T[]> {
  return arrayData(await fetchApi<T[]>(pathname, { accessToken: token }), label);
}

function scopeValue(data: JsonObject, key: "babyId" | "familyId"): unknown {
  const direct = data[key];
  const nested = isObject(data.scope) ? data.scope[key] : undefined;
  if (direct !== undefined && nested !== undefined && direct !== nested) {
    invalidResponse("GrowDesk 通知的作用域字段不一致");
  }
  return direct ?? nested;
}

function notificationMatchesScope(
  data: JsonObject,
  scope: GrowDeskNotificationScope | undefined,
): boolean {
  const babyId = scopeValue(data, "babyId");
  const familyId = scopeValue(data, "familyId");
  if (babyId !== undefined && babyId !== null && typeof babyId !== "string") {
    invalidResponse("GrowDesk 通知的 babyId 无效");
  }
  if (familyId !== undefined && familyId !== null && typeof familyId !== "string") {
    invalidResponse("GrowDesk 通知的 familyId 无效");
  }
  if (!scope) {
    return babyId === undefined || babyId === null
      ? familyId === undefined || familyId === null
      : false;
  }
  return (babyId === undefined || babyId === null || babyId === scope.babyId)
    && (familyId === undefined || familyId === null || familyId === scope.familyId);
}

function validateCanonicalNotification(
  value: unknown,
  userId: string,
  scope: GrowDeskNotificationScope | undefined,
): CanonicalNotification | null {
  if (!isObject(value)) invalidResponse("GrowDesk 返回了无效的通知");
  const id = stringField(value.id, "通知 id");
  const ownerId = stringField(value.userId, "通知 userId");
  if (ownerId !== userId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了不属于当前用户的通知");
  }
  const eventKey = stringField(value.eventKey, "通知 eventKey");
  const title = stringField(value.title, "通知标题");
  const body = stringField(value.body, "通知正文", true);
  const createdAt = stringField(value.createdAt, "通知 createdAt");
  instantField(createdAt, "通知 createdAt");
  if (value.data !== undefined && value.data !== null && !isObject(value.data)) {
    invalidResponse("GrowDesk 通知 data 无效");
  }
  const data = value.data === null || value.data === undefined ? null : value.data;
  if (!notificationMatchesScope(data ?? {}, scope)) return null;
  return { id, userId: ownerId, eventKey, title, body, data, createdAt };
}

function memberMap(members: unknown[], familyId: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const raw of members) {
    if (!isObject(raw)) invalidResponse("GrowDesk 返回了无效的家庭成员");
    const userId = stringField(raw.userId, "成员 userId");
    const memberFamilyId = stringField(raw.familyId, "成员 familyId");
    if (memberFamilyId !== familyId) {
      throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他家庭的成员");
    }
    result.set(userId, stringField(raw.displayName, "成员 displayName", true));
  }
  return result;
}

function sanitizeRemoteNotification(
  item: NotificationItem,
  scope: GrowDeskNotificationScope | undefined,
  members: Map<string, string>,
): NotificationItem {
  const actorId = scope && item.actorId && members.has(item.actorId) ? item.actorId : null;
  return {
    ...item,
    actorId,
    actorLabel: actorId ? members.get(actorId) || null : null,
  };
}

function familyClock(family: JsonObject, nowMs: number): FamilyClock {
  const timeZone = stringField(family.timeZone, "家庭 timeZone");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMEZONE", "家庭时区配置无效");
  }
  const parts = formatter.formatToParts(new Date(nowMs));
  const value = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  if (!isValidDateStr(date)) throw new BridgeError(502, "UPSTREAM_INVALID_TIMEZONE", "家庭时区配置无效");
  const bounds = dayBoundsInTimeZone(date, timeZone);
  return { date, timeZone, startMs: bounds.start.getTime(), endMs: bounds.end.getTime() };
}

function scopedRecord(value: unknown, label: string, scope: GrowDeskNotificationScope): JsonObject {
  if (!isObject(value)) invalidResponse(`GrowDesk 返回了无效的 ${label} 记录`);
  const id = stringField(value.id, `${label} id`);
  const babyId = stringField(value.babyId, `${label} babyId`);
  const familyId = stringField(value.familyId, `${label} familyId`);
  if (babyId !== scope.babyId || familyId !== scope.familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", `GrowDesk 返回了不属于当前宝宝的 ${label} 记录`);
  }
  return { ...value, id, babyId, familyId };
}

function recordTimes(record: JsonObject, label: string): { createdMs: number; updatedMs: number } {
  return {
    createdMs: instantField(record.createdAt, `${label} createdAt`),
    updatedMs: instantField(record.updatedAt, `${label} updatedAt`),
  };
}

function localTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function relativeTime(ms: number, nowMs: number): string {
  const mins = Math.floor(Math.max(0, nowMs - ms) / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function recordDetail(kind: string, record: JsonObject, clock: FamilyClock): string {
  if (kind === "feeding") {
    const type = optionalText(record.feedingType) || "喂奶";
    const amount = optionalText(record.amountMl);
    const notes = optionalText(record.notes);
    return `${type}${amount ? ` ${amount}ml` : ""}${notes ? ` · 备注: ${notes}` : ""}`;
  }
  if (kind === "sleep") {
    const start = localTime(instantField(record.startedAt, "睡眠 startedAt"), clock.timeZone);
    const end = record.endedAt === null || record.endedAt === undefined
      ? "进行中"
      : localTime(instantField(record.endedAt, "睡眠 endedAt"), clock.timeZone);
    const notes = optionalText(record.notes);
    return `${record.sleepType === "night" ? "夜觉" : "小睡"} · ${start} ~ ${end}${notes ? ` · 备注: ${notes}` : ""}`;
  }
  if (kind === "diaper") {
    const type = record.diaperType === "pee" ? "嘘嘘" : record.diaperType === "poop" ? "便便" : "嘘嘘+便便";
    const color = optionalText(record.poopColor);
    const notes = optionalText(record.notes);
    return `${type}${color ? ` (${color})` : ""}${notes ? ` · 备注: ${notes}` : ""}`;
  }
  if (kind === "food") {
    const count = Array.isArray(record.foodItemIds) ? record.foodItemIds.length : 0;
    const portion = optionalText(record.portionDescription) || "正常";
    const reaction = optionalText(record.reaction);
    return `食物 ${count} 项 · 份量: ${portion}${reaction ? ` · 反应: ${reaction}` : ""}`;
  }
  if (kind === "growth") {
    const metrics = [
      record.weightKg ? `体重 ${record.weightKg}kg` : "",
      record.heightCm ? `身高 ${record.heightCm}cm` : "",
      record.headCircumferenceCm ? `头围 ${record.headCircumferenceCm}cm` : "",
    ].filter(Boolean).join(" · ");
    return metrics || "新增生长测量";
  }
  const name = optionalText(record.supplementName) || "补剂打卡";
  const amount = optionalText(record.amount);
  const notes = optionalText(record.notes);
  return `${name}${amount ? ` ${amount}` : ""}${notes ? ` · 备注: ${notes}` : ""}`;
}

const RECORD_KINDS = [
  { kind: "feeding", label: "喂奶记录", icon: "🍼", actor: true },
  { kind: "sleep", label: "睡眠记录", icon: "😴", actor: true },
  { kind: "diaper", label: "换尿布记录", icon: "🧷", actor: true },
  { kind: "food", label: "辅食记录", icon: "🍚", actor: false },
  { kind: "growth", label: "生长数据", icon: "📏", actor: false },
  { kind: "supplement", label: "补剂打卡", icon: "💊", actor: false },
] as const;

export function buildFamilyRecordNotifications(
  recordsByKind: Record<string, JsonObject[]>,
  scope: GrowDeskNotificationScope,
  members: Map<string, string>,
  clock: FamilyClock,
  nowMs = Date.now(),
): NotificationItem[] {
  const sinceMs = nowMs - 24 * 60 * 60 * 1000;
  const result: NotificationItem[] = [];
  for (const descriptor of RECORD_KINDS) {
    for (const raw of recordsByKind[descriptor.kind] || []) {
      const record = scopedRecord(raw, descriptor.label, scope);
      const times = recordTimes(record, descriptor.label);
      let action: "created" | "updated" | null = null;
      let eventMs = 0;
      if (times.createdMs >= sinceMs && times.createdMs <= nowMs) {
        action = "created";
        eventMs = times.createdMs;
      } else if (times.updatedMs > times.createdMs && times.updatedMs >= sinceMs && times.updatedMs <= nowMs) {
        action = "updated";
        eventMs = times.updatedMs;
      }
      if (!action) continue;

      let actorId: string | null = null;
      let actorLabel: string | null = null;
      // recordedByUserId is authoritative only for creation. The canonical
      // record DTO has no updatedBy field, so an update must not be attributed.
      if (action === "created" && descriptor.actor && record.recordedByUserId !== undefined && record.recordedByUserId !== null) {
        const recordedBy = stringField(record.recordedByUserId, `${descriptor.label} recordedByUserId`);
        if (members.has(recordedBy)) {
          actorId = recordedBy;
          actorLabel = members.get(recordedBy) || null;
        }
      }
      const actorPrefix = actorLabel ? `${actorLabel} ` : "";
      result.push({
        id: `family-${descriptor.kind}-${record.id}-${action}`,
        type: "family",
        title: `${descriptor.icon} ${actorPrefix}${action === "created" ? "记录了" : "修改了"}${descriptor.label}`,
        detail: recordDetail(descriptor.kind, record, clock),
        time: relativeTime(eventMs, nowMs),
        urgent: false,
        icon: descriptor.icon,
        ...(actorId ? { actorId, actorLabel } : {}),
        createdAt: eventMs,
      });
    }
  }
  return result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 20);
}

function doseNumber(notes: unknown): number {
  const match = typeof notes === "string" ? notes.match(/第\s*(\d+)\s*剂|剂次\s*:\s*第?\s*(\d+)/) : null;
  const value = match ? Number(match[1] || match[2]) : 1;
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function savedSelection(
  value: unknown,
  code: string,
  dose: number,
): { selected?: boolean; completed?: boolean } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) invalidResponse("GrowDesk 食物计划中的疫苗选择无效");
  const planData = isObject(value.planData) ? value.planData : value;
  const selections = planData.vaccineSelections;
  if (selections === undefined || selections === null) return undefined;
  if (!isObject(selections)) invalidResponse("GrowDesk 食物计划中的疫苗选择无效");
  const selected = selections[`${code}-${dose}`];
  if (selected === undefined || selected === null) return undefined;
  if (!isObject(selected)) invalidResponse("GrowDesk 食物计划中的疫苗选择无效");
  if (selected.selected !== undefined && typeof selected.selected !== "boolean") invalidResponse("GrowDesk 疫苗 selected 无效");
  if (selected.completed !== undefined && typeof selected.completed !== "boolean") invalidResponse("GrowDesk 疫苗 completed 无效");
  return selected as { selected?: boolean; completed?: boolean };
}

export function buildVaccineReminderNotifications(
  schedule: unknown[],
  records: JsonObject[],
  plan: unknown,
  scope: GrowDeskNotificationScope,
  clock: FamilyClock,
  nowMs = Date.now(),
): NotificationItem[] {
  const completed = new Set<string>();
  for (const raw of records) {
    const record = scopedRecord(raw, "疫苗", scope) as VaccineRecord;
    const code = stringField(record.vaccineCode, "疫苗 vaccineCode");
    dateField(record.administeredDate, "疫苗 administeredDate");
    completed.add(`${code}-${doseNumber(record.notes)}`);
  }

  const birthDate = dateField(scope.birthDate, "宝宝 birthDate");
  const result: NotificationItem[] = [];
  const emitted = new Set<string>();
  for (const raw of schedule) {
    if (!isObject(raw)) invalidResponse("GrowDesk 返回了无效的疫苗计划");
    const code = stringField(raw.vaccineCode, "疫苗计划 vaccineCode");
    const name = stringField(raw.name, "疫苗计划 name");
    const months = raw.recommendedAgeMonths;
    const dose = raw.doseNumber;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 0) invalidResponse("GrowDesk 疫苗计划月龄无效");
    if (typeof dose !== "number" || !Number.isInteger(dose) || dose < 1) invalidResponse("GrowDesk 疫苗计划剂次无效");
    const key = `${code}-${dose}`;
    if (emitted.has(key)) continue;
    const selection = savedSelection(plan, code, dose);
    if (completed.has(key) || selection?.completed === true || selection?.selected === false) continue;
    const dueDate = addMonths(birthDate, months);
    if (!isValidDateStr(dueDate)) invalidResponse("GrowDesk 疫苗计划日期无效");
    const days = diffCalendarDays(clock.date, dueDate);
    if (days > 7) continue;
    const time = days < 0 ? `已过期 ${Math.abs(days)} 天` : days === 0 ? "今天" : `${days} 天后`;
    result.push({
      id: `vaccine-${code}-${dose}`,
      type: "vaccine",
      title: `💉 ${name} 第${dose}剂`,
      detail: `计划接种日期：${dueDate}`,
      time,
      urgent: days <= 3,
      icon: "💉",
      createdAt: nowMs,
    });
    emitted.add(key);
  }
  return result;
}

export function buildDailyReminderNotifications(
  recordsByKind: Record<string, JsonObject[]>,
  scope: GrowDeskNotificationScope,
  clock: FamilyClock,
  nowMs = Date.now(),
): NotificationItem[] {
  const feeding = (recordsByKind.feeding || []).map(raw => scopedRecord(raw, "喂奶", scope));
  const sleep = (recordsByKind.sleep || []).map(raw => scopedRecord(raw, "睡眠", scope));
  const food = (recordsByKind.food || []).map(raw => scopedRecord(raw, "辅食", scope));
  const hasFeeding = feeding.some(record => {
    const at = instantField(record.occurredAt, "喂奶 occurredAt");
    return at >= clock.startMs && at < clock.endMs;
  });
  const hasSleep = sleep.some(record => {
    const start = instantField(record.startedAt, "睡眠 startedAt");
    const end = record.endedAt === null || record.endedAt === undefined
      ? Number.POSITIVE_INFINITY
      : instantField(record.endedAt, "睡眠 endedAt");
    if (end < start) invalidResponse("GrowDesk 返回了无效的睡眠区间");
    return start < clock.endMs && end > clock.startMs;
  });
  const hasFood = food.some(record => dateField(record.recordDate, "辅食 recordDate") === clock.date);
  const result: NotificationItem[] = [];
  if (!hasFeeding) result.push({ id: "daily-feeding", type: "daily", title: "🍼 记录喂奶", detail: "该记录今天的喂奶了", time: "今天", urgent: false, icon: "🍼", createdAt: nowMs });
  if (!hasSleep) result.push({ id: "daily-sleep", type: "daily", title: "😴 记录睡眠", detail: "该记录今天的睡眠了", time: "今天", urgent: false, icon: "😴", createdAt: nowMs });
  if (!hasFood) result.push({ id: "daily-food", type: "daily", title: "🍚 记录辅食", detail: "该记录今天的辅食了", time: "今天", urgent: false, icon: "🍚", createdAt: nowMs });
  return result;
}

export function buildDataReleaseNotification(dataRelease: unknown, nowMs = Date.now()): NotificationItem | null {
  if (dataRelease === undefined || dataRelease === null) return null;
  if (!isObject(dataRelease)) invalidResponse("GrowDesk 返回了无效的数据版本");
  const asOf = dataRelease.asOf === undefined || dataRelease.asOf === null ? "" : dateField(dataRelease.asOf, "数据版本 asOf");
  const title = stringField(dataRelease.title, "数据版本标题");
  const sources = Array.isArray(dataRelease.sources) ? dataRelease.sources : [];
  if (sources.length === 0) invalidResponse("GrowDesk 数据版本缺少来源");
  const firstSource = sources[0];
  if (!isObject(firstSource)) invalidResponse("GrowDesk 数据版本来源无效");
  const organization = stringField(firstSource.organization, "数据版本来源机构");
  return {
    id: `data-release-${asOf || "current"}`,
    type: "data_release",
    title: `📊 ${title}`,
    detail: `数据依据：${organization}${asOf ? ` · 数据核对日期：${asOf}` : ""}`,
    time: asOf || "刚刚",
    urgent: false,
    icon: "📊",
    createdAt: nowMs,
  };
}

export async function fetchGrowDeskNotificationItems(
  fetchApi: BridgeFetch,
  token: string,
  userId: string,
  scope?: GrowDeskNotificationScope,
  nowMs = Date.now(),
): Promise<NotificationItem[]> {
  const rawRemote = await fetchCompleteList<unknown>(fetchApi, token, "/api/v1/notifications");
  const remote = rawRemote
    .map(item => validateCanonicalNotification(item, userId, scope))
    .filter((item): item is CanonicalNotification => item !== null)
    .map(item => fromGrowDeskNotification(item));

  if (!scope) {
    const seen = new Set<string>();
    return remote.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }).map(item => sanitizeRemoteNotification(item, undefined, new Map()));
  }

  const familyPath = `/api/v1/families/${pathId(scope.familyId)}`;
  const babyPath = `/api/v1/babies/${pathId(scope.babyId)}`;
  const [familyRaw, membersRaw, feedings, sleeps, diapers, foods, supplements, growths, vaccineRecords, vaccineSchedule, foodPlan, milestoneResponse] = await Promise.all([
    fetchApi<JsonObject>(familyPath, { accessToken: token }),
    fetchArray<JsonObject>(fetchApi, token, `${familyPath}/members`, "家庭成员"),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/records/feeding`),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/records/sleep`),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/records/diaper`),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/records/food`),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/records/supplement`),
    fetchCompleteList<unknown>(fetchApi, token, `${babyPath}/growth-measurements`),
    fetchArray<JsonObject>(fetchApi, token, `${babyPath}/vaccines/records`, "疫苗记录"),
    fetchArray<JsonObject>(fetchApi, token, `${babyPath}/vaccines/schedule`, "疫苗计划"),
    fetchApi<JsonObject>(`${babyPath}/food-plan`, { accessToken: token }),
    fetchApi<JsonObject>("/api/v1/development/milestones", { accessToken: token }),
  ]);
  const family = requireData(familyRaw);
  if (!isObject(family) || family.id !== scope.familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他家庭的信息");
  }
  const milestoneData = requireData(milestoneResponse);
  if (!Array.isArray(milestoneData)) {
    invalidResponse("GrowDesk 返回的发育参考数据不是数组");
  }
  const clock = familyClock(family, nowMs);
  const members = memberMap(membersRaw, scope.familyId);
  const recordsByKind: Record<string, JsonObject[]> = {
    feeding: feedings.map(raw => scopedRecord(raw, "喂奶", scope)),
    sleep: sleeps.map(raw => scopedRecord(raw, "睡眠", scope)),
    diaper: diapers.map(raw => scopedRecord(raw, "换尿布", scope)),
    food: foods.map(raw => scopedRecord(raw, "辅食", scope)),
    supplement: supplements.map(raw => scopedRecord(raw, "补剂", scope)),
    growth: growths.map(raw => scopedRecord(raw, "生长", scope)),
  };
  const familyItems = buildFamilyRecordNotifications(recordsByKind, scope, members, clock, nowMs);
  const dailyItems = buildDailyReminderNotifications(recordsByKind, scope, clock, nowMs);
  const planData = requireData(foodPlan);
  if (!isObject(planData)) invalidResponse("GrowDesk 返回的食物计划无效");
  if (planData.babyId !== undefined && planData.babyId !== scope.babyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝的食物计划");
  }
  const vaccineItems = buildVaccineReminderNotifications(vaccineSchedule, vaccineRecords, planData, scope, clock, nowMs);
  const dataRelease = (milestoneResponse as BridgeResult<JsonObject> & { dataRelease?: unknown }).dataRelease;
  if (dataRelease === undefined || dataRelease === null) {
    invalidResponse("GrowDesk 未返回发育参考数据版本");
  }
  const releaseItem = buildDataReleaseNotification(dataRelease, nowMs);
  const scopedRemote = remote.map(item => sanitizeRemoteNotification(item, scope, members));
  const all = [...scopedRemote, ...vaccineItems, ...dailyItems, ...familyItems, ...(releaseItem ? [releaseItem] : [])];
  const seen = new Set<string>();
  return all
    .filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

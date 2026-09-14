/** Wire-format helpers shared by the BFF. No Prisma or framework dependency. */
export class BridgeError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface BridgeResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  page?: { nextCursor: string | null };
  error?: { code: string; message: string; details?: unknown; requestId?: string };
}

export type BridgeFetch = <T>(path: string, options?: {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  accessToken?: string;
  body?: unknown;
  idempotencyKey?: string;
}) => Promise<BridgeResult<T>>;

export function requireData<T>(result: BridgeResult<T>): T {
  if (!result.ok) {
    throw new BridgeError(result.status, result.error?.code || "UPSTREAM_ERROR",
      result.error?.message || "GrowDesk 请求失败", result.error?.details);
  }
  if (result.data === undefined) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "GrowDesk 返回了不完整的数据");
  }
  return result.data;
}

export function bridgeErrorResponse(error: unknown): Response {
  if (error instanceof BridgeError) {
    return Response.json({ error: error.message, code: error.code, details: error.details },
      { status: error.status, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ error: "GrowDesk 请求处理失败", code: "BRIDGE_INTERNAL_ERROR" },
    { status: 500, headers: { "cache-control": "no-store" } });
}

/** Never pass a client-controlled value through a URL path unescaped. */
export function pathId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new BridgeError(400, "INVALID_ID", "记录或宝宝 ID 格式错误");
  }
  return encodeURIComponent(value);
}

/** The API contract uses decimal strings; never silently round an unsafe JS integer. */
export function wireVersion(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    throw new BridgeError(428, "BASE_VERSION_REQUIRED", "请刷新记录后重试，缺少原记录版本");
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) {
    throw new BridgeError(400, "INVALID_VERSION", "记录版本必须是正整数");
  }
  if ((typeof value !== "number" && typeof value !== "string") || !/^[1-9]\d*$/.test(String(value))) {
    throw new BridgeError(400, "INVALID_VERSION", "记录版本必须是正整数字符串");
  }
  return String(value);
}

export type FeedingKind = "breast" | "bottle" | "formula" | "mixed";
export function feedingKind(value: unknown): FeedingKind {
  if (value === "bottle_breast") return "bottle";
  if (value === "breast" || value === "bottle" || value === "formula" || value === "mixed") return value;
  throw new BridgeError(400, "INVALID_FEEDING_TYPE", "不支持的喂养类型");
}

export function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BridgeError(400, "INVALID_DATE", "日期必须为 YYYY-MM-DD");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BridgeError(400, "INVALID_DATE", "无效的日历日期");
  }
  return value;
}

export function isoTimestamp(value: unknown): string {
  // Reject wall-clock timestamps whose timezone would depend on the Node host.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new BridgeError(400, "INVALID_TIMESTAMP", "记录时间必须包含日期和时区");
  }
  calendarDate(value.slice(0, 10));
  const clock = /T(\d{2}):(\d{2})(?::(\d{2}))?/i.exec(value)!;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59) {
    throw new BridgeError(400, "INVALID_TIMESTAMP", "无效的记录时刻");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BridgeError(400, "INVALID_TIMESTAMP", "无效的记录时间");
  return parsed.toISOString();
}

export interface ApiBaby {
  id: string; familyId: string; name: string; birthDate: string;
  gender: "boy" | "girl" | "other";
  avatarUrl: string | null; gestationalWeeks: number | null; gestationalDays: number | null;
  createdAt: string; updatedAt: string;
}
export function legacyBaby(baby: ApiBaby) {
  return {
    id: baby.id, familyId: baby.familyId, nickname: baby.name,
    birthDate: baby.birthDate, gender: baby.gender === "boy" ? "male" : baby.gender === "girl" ? "female" : "unknown",
    avatarUrl: baby.avatarUrl, gestationalAge: baby.gestationalWeeks,
    // Preserve the extra precision even though the legacy form does not expose it.
    gestationalDays: baby.gestationalDays, createdAt: baby.createdAt, updatedAt: baby.updatedAt,
  };
}
export function babyPayload(body: Record<string, unknown>, patch = false): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!patch || body.nickname !== undefined) {
    if (typeof body.nickname !== "string" || !body.nickname.trim()) throw new BridgeError(400, "INVALID_BABY_NAME", "nickname 必填");
    result.name = body.nickname.trim();
  }
  if (!patch || body.birthDate !== undefined) result.birthDate = calendarDate(body.birthDate);
  if (!patch || body.gender !== undefined) {
    if (!["male", "female", "unknown"].includes(String(body.gender))) throw new BridgeError(400, "INVALID_GENDER", "无效的宝宝性别");
    result.gender = body.gender === "male" ? "boy" : body.gender === "female" ? "girl" : "other";
  }
  if (body.gestationalAge !== undefined) {
    const weeks = body.gestationalAge;
    if (weeks !== null && (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 20 || weeks > 45)) {
      throw new BridgeError(400, "INVALID_GESTATIONAL_AGE", "孕周必须为 20–45 之间的整数");
    }
    result.gestationalWeeks = weeks;
  }
  if (body.gestationalDays !== undefined) {
    const days = body.gestationalDays;
    if (days !== null && (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 6)) {
      throw new BridgeError(400, "INVALID_GESTATIONAL_DAYS", "孕天数必须为 0–6 之间的整数");
    }
    result.gestationalDays = days;
  }
  if (body.avatarUrl !== undefined) {
    // Only private attachment references; the API verifies ownership before binding.
    if (body.avatarUrl !== null && body.avatarUrl !== "" && (typeof body.avatarUrl !== "string" || !/^\/api\/attachments\/[a-f0-9-]{36}$/i.test(body.avatarUrl))) throw new BridgeError(422, "INVALID_AVATAR", "请使用新附件上传头像");
    result.avatarUrl = body.avatarUrl || null;
  }
  return result;
}

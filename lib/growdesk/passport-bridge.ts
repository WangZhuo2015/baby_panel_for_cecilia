import { BridgeError } from "./bridge-protocol";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAIR_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CLAIM_KEYS = new Set(["pairCode", "babyId", "deviceLabel"]);

export interface PassportClaimInput {
  pairCode: string;
  babyId: string;
  deviceLabel?: string;
}

export interface PassportDeviceSummary {
  id: string;
  familyId: string;
  babyId: string;
  deviceLabel: string;
  firmwareVersion: string | null;
  hardwareVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function passportDeviceId(value: unknown): string {
  if (!isUuid(value)) throw new BridgeError(400, "INVALID_DEVICE_ID", "Passport 设备 ID 格式错误");
  return value;
}

export function normalizePassportPairCode(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 20) {
    throw new BridgeError(400, "INVALID_PAIR_CODE", "配对码格式错误");
  }
  const compact = value.trim().toUpperCase().replace(/[ -]/g, "");
  if (compact.length !== 8 || [...compact].some((char) => !PAIR_CODE_ALPHABET.includes(char))) {
    throw new BridgeError(400, "INVALID_PAIR_CODE", "配对码格式错误");
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function parsePassportClaimInput(value: unknown): PassportClaimInput {
  if (!isRecord(value)) throw new BridgeError(400, "INVALID_CLAIM_REQUEST", "请求内容必须是 JSON 对象");
  if (Object.keys(value).some((key) => !CLAIM_KEYS.has(key))) {
    throw new BridgeError(400, "INVALID_CLAIM_REQUEST", "请求只允许 pairCode、babyId 和 deviceLabel 字段");
  }

  const pairCode = normalizePassportPairCode(value.pairCode);
  if (!isUuid(value.babyId)) throw new BridgeError(400, "INVALID_BABY_ID", "宝宝 ID 格式错误");

  let deviceLabel: string | undefined;
  if (value.deviceLabel !== undefined) {
    if (typeof value.deviceLabel !== "string") {
      throw new BridgeError(400, "INVALID_DEVICE_LABEL", "设备名称必须是文本");
    }
    deviceLabel = value.deviceLabel.trim();
    if (!deviceLabel || [...deviceLabel].length > 100) {
      throw new BridgeError(400, "INVALID_DEVICE_LABEL", "设备名称不能为空且不能超过 100 个字符");
    }
  }

  return { pairCode, babyId: value.babyId, ...(deviceLabel === undefined ? {} : { deviceLabel }) };
}

export interface PassportListQuery {
  cursor?: string;
  limit?: number;
}

export function parsePassportListQuery(url: string): PassportListQuery {
  const params = new URL(url).searchParams;
  for (const key of params.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw new BridgeError(400, "INVALID_PASSPORT_QUERY", "只支持 cursor 和 limit 分页参数");
    }
  }

  const cursors = params.getAll("cursor");
  const limits = params.getAll("limit");
  if (cursors.length > 1 || limits.length > 1) {
    throw new BridgeError(400, "INVALID_PASSPORT_QUERY", "分页参数不能重复");
  }

  const cursor = cursors[0];
  if (cursor !== undefined && cursor.length > 2048) {
    throw new BridgeError(400, "INVALID_PASSPORT_CURSOR", "分页游标过长");
  }

  let limit: number | undefined;
  if (limits[0] !== undefined) {
    if (!/^[1-9]\d{0,2}$/.test(limits[0]!)) {
      throw new BridgeError(400, "INVALID_PASSPORT_LIMIT", "分页条数必须是 1–100 的整数");
    }
    limit = Number(limits[0]);
    if (limit > 100) throw new BridgeError(400, "INVALID_PASSPORT_LIMIT", "分页条数必须是 1–100 的整数");
  }

  return {
    ...(cursor === undefined || cursor === "" ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "Passport 设备列表包含无效字段");
  }
  return value;
}

function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value !== null && typeof value !== "string") {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "Passport 设备列表包含无效字段");
  }
  return value as string | null;
}

/** Return only UI-safe device fields; never forward raw upstream records or capabilities. */
export function toPassportDeviceSummary(value: unknown): PassportDeviceSummary {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.familyId) || !isUuid(value.babyId)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RESPONSE", "Passport 设备列表包含无效设备记录");
  }
  return {
    id: value.id,
    familyId: value.familyId,
    babyId: value.babyId,
    deviceLabel: requiredString(value, "deviceLabel"),
    firmwareVersion: nullableString(value, "firmwareVersion"),
    hardwareVersion: nullableString(value, "hardwareVersion"),
    lastSeenAt: nullableString(value, "lastSeenAt"),
    revokedAt: nullableString(value, "revokedAt"),
    createdAt: requiredString(value, "createdAt"),
    updatedAt: requiredString(value, "updatedAt"),
  };
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

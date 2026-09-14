import { BridgeError, isoTimestamp, wireVersion } from "./bridge-protocol";

export function optionalText(value: unknown, label: string, maxLength = 1000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BridgeError(400, "INVALID_TEXT", `${label} 格式错误`);
  const text = value.trim();
  if (text.length > maxLength) throw new BridgeError(400, "TEXT_TOO_LONG", `${label} 不能超过 ${maxLength} 个字符`);
  return text || null;
}

export function requiredEnum<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new BridgeError(400, "INVALID_ENUM", `${label} 值无效`);
  }
  return value as T;
}

export function nonNegativeInteger(value: unknown, label: string, defaultValue?: number): number {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new BridgeError(400, "INVALID_NUMBER", `${label} 必须为非负整数`);
  }
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    throw new BridgeError(400, "INVALID_NUMBER", `${label} 必须为非负整数`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new BridgeError(400, "INVALID_NUMBER", `${label} 必须为非负整数`);
  }
  return number;
}

export function requiredTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BridgeError(400, "INVALID_TIMESTAMP", `${label} 必填且必须包含日期和时区`);
  }
  return isoTimestamp(value);
}

export function optionalTimestamp(value: unknown, label: string): string | null {
  if (value === null || value === "") return null;
  if (value === undefined) throw new BridgeError(400, "INVALID_TIMESTAMP", `${label} 格式错误`);
  return requiredTimestamp(value, label);
}

export function legacyVersion(value: unknown): string {
  return wireVersion(value);
}

/** Accept the legacy foods array as well as the canonical foodItemIds alias. */
export function foodItemIds(value: unknown): string[] {
  let raw: unknown[];
  if (value === undefined || value === null || value === "") raw = [];
  else if (Array.isArray(value)) raw = value;
  else if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      raw = Array.isArray(parsed) ? parsed : [value];
    } catch {
      raw = [value];
    }
  } else {
    throw new BridgeError(400, "INVALID_FOOD_ITEMS", "foods 必须为食材 ID 数组");
  }
  if (raw.length > 20) throw new BridgeError(400, "TOO_MANY_FOOD_ITEMS", "foods 不能超过 20 项");
  return raw.map((food) => {
    const id = typeof food === "object" && food !== null && "id" in food
      ? (food as { id?: unknown }).id
      : food;
    if (typeof id !== "string" || !id.trim()) throw new BridgeError(400, "INVALID_FOOD_ITEMS", "foods 必须为非空食材 ID");
    return id.trim();
  });
}

export function legacyWallClock(value: unknown, label = "time"): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BridgeError(400, "INVALID_TIME", `${label} 必须为 HH:MM 格式`);
  }
  return value;
}

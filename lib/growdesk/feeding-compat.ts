if (typeof window !== "undefined") throw new Error("This module can only be loaded on the server.");
import { BridgeError, feedingKind, isoTimestamp, wireVersion, type FeedingKind } from "./bridge-protocol";

export interface LegacyFeedingRecord {
  id: string; babyId: string; type: "breast" | "bottle_breast" | "formula" | "mixed";
  timestamp: string; amountMl: number | null; leftMinutes: number | null; rightMinutes: number | null;
  spitUp: boolean; formulaProductId?: string | null; notes: string | null;
  source?: string; sourceAgent?: string | null; recordedById?: string | null; version: string; baseVersion: string;
  createdAt: string; updatedAt: string;
}
export interface GrowDeskFeedingRecord {
  id: string; babyId: string; familyId: string; feedingType: FeedingKind;
  occurredAt: string; amountMl: string | null; leftMinutes: number | null; rightMinutes: number | null;
  spitUp: boolean; formulaProductId: string | null; notes: string | null;
  source: string; sourceAgent: string | null; recordedByUserId?: string | null; version: string; createdAt: string; updatedAt: string;
}
function nullableNumber(value: unknown, integer = false): number | null {
  if (value === undefined || value === null || value === "") return null;
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new BridgeError(400, "INVALID_NUMBER", "奶量和时长必须为非负数");
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isSafeInteger(n))) {
    throw new BridgeError(400, "INVALID_NUMBER", "奶量必须为非负数，时长必须为非负整数");
  }
  return n;
}
function milk(value: unknown): string | null {
  const n = nullableNumber(value);
  if (n === null) return null;
  const text = String(n);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new BridgeError(400, "INVALID_AMOUNT", "奶量超出可表示范围");
  return text;
}
function nullableText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BridgeError(400, "INVALID_TEXT", "文本字段格式错误");
  return value;
}
export function toGrowDeskFeedingCreatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    feedingType: feedingKind(body.type),
    occurredAt: isoTimestamp(body.timestamp),
    amountMl: milk(body.amountMl),
    leftMinutes: nullableNumber(body.leftMinutes, true),
    rightMinutes: nullableNumber(body.rightMinutes, true),
    spitUp: body.spitUp === true || body.spitUp === "true" || body.spitUp === 1,
    source: typeof body.source === "string" ? body.source : "ui_manual",
  };
  const formulaProductId = nullableText(body.formulaProductId);
  if (formulaProductId !== null) {
    payload.formulaProductId = formulaProductId;
  }
  const notes = nullableText(body.notes);
  if (notes !== null) {
    payload.notes = notes;
  }
  const sourceAgent = nullableText(body.sourceAgent);
  if (sourceAgent !== null) {
    payload.sourceAgent = sourceAgent;
  }
  return payload;
}
export function toGrowDeskFeedingUpdatePayload(body: Record<string, unknown>) {
  const out: Record<string, unknown> = { baseVersion: wireVersion(body.baseVersion ?? body.version) };
  if (body.type !== undefined) out.feedingType = feedingKind(body.type);
  if (body.timestamp !== undefined) out.occurredAt = isoTimestamp(body.timestamp);
  if (body.amountMl !== undefined) out.amountMl = milk(body.amountMl);
  if (body.leftMinutes !== undefined) out.leftMinutes = nullableNumber(body.leftMinutes, true);
  if (body.rightMinutes !== undefined) out.rightMinutes = nullableNumber(body.rightMinutes, true);
  if (body.spitUp !== undefined) out.spitUp = body.spitUp === true || body.spitUp === "true" || body.spitUp === 1;
  if (body.formulaProductId !== undefined) {
    const pid = nullableText(body.formulaProductId);
    if (pid !== null) {
      out.formulaProductId = pid;
    }
  }
  if (body.notes !== undefined) out.notes = nullableText(body.notes);
  return out;
}
export function fromGrowDeskFeedingRecord(rec: GrowDeskFeedingRecord): LegacyFeedingRecord {
  const version = wireVersion(rec.version);
  return {
    id: rec.id, babyId: rec.babyId,
    type: rec.feedingType === "bottle" ? "bottle_breast" : rec.feedingType,
    timestamp: rec.occurredAt, amountMl: rec.amountMl === null ? null : Number(rec.amountMl),
    leftMinutes: rec.leftMinutes, rightMinutes: rec.rightMinutes, spitUp: rec.spitUp,
    formulaProductId: rec.formulaProductId, notes: rec.notes, source: rec.source, sourceAgent: rec.sourceAgent, recordedById: rec.recordedByUserId ?? null,
    version, baseVersion: version, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
  };
}

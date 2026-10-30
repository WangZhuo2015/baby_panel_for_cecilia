import { BridgeError, pathId, requireData, type BridgeFetch } from "./bridge-protocol";

export interface ScheduledDailySummary {
  schemaVersion: 1;
  kind: "scheduled_daily_summary";
  date: string;
  babyId: string;
  generatedAt: string;
  llm: {
    source: "api";
    provider: "developer.amd.com.cn";
    model: "DeepSeek-V4.1-Flash";
  };
  headline: string;
  highlights: string[];
  sections: {
    feeding: string;
    sleep: string;
    diaper: string;
    growthAndCare: string;
    tomorrowTips: string;
  };
  suggestedQuestions: string[];
  disclaimer: string;
  overallScore: string;
  overallRating: number;
  statusLevel: "excellent" | "good" | "attention";
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const MAX_CONTENT_BYTES = 64 * 1024;

function invalidSummary(): BridgeError {
  return new BridgeError(502, "UPSTREAM_INVALID_SCHEDULED_SUMMARY", "GrowDesk 返回了无效的定时日报");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validInstant(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function boundedTextArray(value: unknown, maxItems: number, maxText: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => boundedText(item, maxText));
}

/** Parse only the stable AMD scheduled-summary contract; legacy plain text remains absent. */
export function parseScheduledDailySummary(
  raw: unknown,
  expectedBabyId: string,
  expectedDate: string,
): ScheduledDailySummary | null {
  let content = raw;
  if (typeof raw === "string") {
    if (Buffer.byteLength(raw, "utf8") > MAX_CONTENT_BYTES) throw invalidSummary();
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try { content = JSON.parse(trimmed) as unknown; } catch { throw invalidSummary(); }
  }
  if (!isRecord(content)) return null;
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(content), "utf8"); } catch { throw invalidSummary(); }
  if (size > MAX_CONTENT_BYTES) throw invalidSummary();
  if (content.kind !== "scheduled_daily_summary" || content.schemaVersion !== 1) return null;

  const sections = content.sections;
  const llm = content.llm;
  if (
    content.babyId !== expectedBabyId || content.date !== expectedDate ||
    !validDate(content.date) || !validInstant(content.generatedAt) ||
    !isRecord(llm) || llm.source !== "api" || llm.provider !== "developer.amd.com.cn" || llm.model !== "DeepSeek-V4.1-Flash" ||
    !boundedText(content.headline, 800) || !boundedTextArray(content.highlights, 12, 240) ||
    !isRecord(sections) || !boundedText(sections.feeding, 3000) || !boundedText(sections.sleep, 3000) ||
    !boundedText(sections.diaper, 3000) || !boundedText(sections.growthAndCare, 3000) || !boundedText(sections.tomorrowTips, 3000) ||
    !boundedTextArray(content.suggestedQuestions, 12, 400) || !boundedText(content.disclaimer, 1500) ||
    !boundedText(content.overallScore, 120) || typeof content.overallRating !== "number" ||
    !Number.isFinite(content.overallRating) || content.overallRating < 0 || content.overallRating > 5 ||
    !["excellent", "good", "attention"].includes(String(content.statusLevel))
  ) {
    throw invalidSummary();
  }

  return {
    schemaVersion: 1,
    kind: "scheduled_daily_summary",
    date: expectedDate,
    babyId: expectedBabyId,
    generatedAt: content.generatedAt,
    llm: { source: "api", provider: "developer.amd.com.cn", model: "DeepSeek-V4.1-Flash" },
    headline: content.headline,
    highlights: [...content.highlights],
    sections: {
      feeding: sections.feeding,
      sleep: sections.sleep,
      diaper: sections.diaper,
      growthAndCare: sections.growthAndCare,
      tomorrowTips: sections.tomorrowTips,
    },
    suggestedQuestions: [...content.suggestedQuestions],
    disclaimer: content.disclaimer,
    overallScore: content.overallScore,
    overallRating: content.overallRating,
    statusLevel: content.statusLevel as ScheduledDailySummary["statusLevel"],
  };
}

/** Read a bounded keyset window from the baby-scoped list endpoint. */
async function loadScheduledDailySummary(
  fetchApi: BridgeFetch,
  accessToken: string,
  babyId: string,
  date: string,
): Promise<ScheduledDailySummary | null> {
  if (!validDate(date)) throw new BridgeError(400, "INVALID_DATE", "日报日期格式无效");
  const endpoint = `/api/v1/babies/${pathId(babyId)}/daily-summaries`;
  const visited = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor !== null) query.set("cursor", cursor);
    const response = await fetchApi<unknown[]>(`${endpoint}?${query.toString()}`, { accessToken });
    const items = requireData(response);
    const nextCursor = response.page?.nextCursor;
    if (!Array.isArray(items) || items.length > PAGE_SIZE ||
        !(nextCursor === null || (typeof nextCursor === "string" && nextCursor.length > 0))) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回完整的定时日报分页信息");
    }

    for (const item of items) {
      if (!isRecord(item) || typeof item.babyId !== "string" || item.babyId !== babyId || !validDate(item.targetDate)) {
        throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了无效或跨宝宝的定时日报记录");
      }
      if (item.kind !== undefined && item.kind !== "scheduled_daily_summary") throw invalidSummary();
      if (item.targetDate !== date) continue;
      return parseScheduledDailySummary(item.content, babyId, date);
    }

    if (nextCursor === null) return null;
    if (items.length === 0 || visited.has(nextCursor)) {
      throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 定时日报分页没有继续前进");
    }
    visited.add(nextCursor);
    cursor = nextCursor;
    if (pageNumber + 1 === MAX_PAGES) {
      throw new BridgeError(503, "SCHEDULED_SUMMARY_SCAN_LIMIT", "定时日报查询超出扫描范围");
    }
  }
  throw new BridgeError(503, "SCHEDULED_SUMMARY_SCAN_LIMIT", "定时日报查询超出扫描范围");
}


/** Preserve non-authority failures as opaque telemetry while allowing the page to show deterministic stats. */
export async function fetchScheduledDailySummary(
  fetchApi: BridgeFetch,
  accessToken: string,
  babyId: string,
  date: string,
): Promise<ScheduledDailySummary | null> {
  try {
    return await loadScheduledDailySummary(fetchApi, accessToken, babyId, date);
  } catch (error) {
    if (!(error instanceof BridgeError && (error.status === 401 || error.status === 403))) {
      const code = error instanceof BridgeError && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "UNKNOWN";
      const status = error instanceof BridgeError ? error.status : 0;
      console.warn("scheduled_daily_summary.lookup_error", { code, status });
    }
    throw error;
  }
}

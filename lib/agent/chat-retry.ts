import { createHash } from "node:crypto";

export type ChatTurnStatus = "running" | "completed" | "failed" | "cancelled";

export interface ChatTurnReceipt {
  type: "llm_turn";
  turnId: string;
  status: ChatTurnStatus;
  attempt: number;
  retryable: boolean;
  writeToolStarted: boolean;
  error?: string;
}

export interface ChatLlmModelInfo {
  source: "api" | "chatgpt";
  provider: string;
  model: string;
  profileId?: string;
}

export interface ChatLlmModelReceipt {
  type: "llm_model";
  llm: ChatLlmModelInfo;
}

export interface ChatRetryContext {
  available: boolean;
  contextDetail?: unknown;
}

export const CHAT_TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WRITE_TOOLS = new Set(["save_medical_report", "record_vaccine", "delete_record"]);

function deterministicMessageUuid(input: string): string {
  const bytes = createHash("sha256").update(input).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable owner/session/turn scoped UUID accepted by Web AI message APIs. */
export function stableChatUserMessageId(ownerId: string, sessionId: string, turnId: string): string {
  if (!CHAT_TURN_ID_PATTERN.test(turnId)) throw new Error("Invalid chat turn ID");
  return deterministicMessageUuid(`baby-panel-chat-message\0${ownerId}\0${sessionId}\0user\0${turnId.toLowerCase()}`);
}

/** One assistant row per attempt keeps history immutable while the user message remains singular. */
export function stableChatAssistantMessageId(ownerId: string, sessionId: string, turnId: string, attempt: number): string {
  if (!CHAT_TURN_ID_PATTERN.test(turnId)) throw new Error("Invalid chat turn ID");
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 100) throw new Error("Invalid chat attempt");
  return deterministicMessageUuid(`baby-panel-chat-message\0${ownerId}\0${sessionId}\0assistant\0${turnId.toLowerCase()}\0${attempt}`);
}

/** Immutable claim ID for one retry attempt; first insertion owns that attempt. */
export function stableChatRetryClaimMessageId(ownerId: string, sessionId: string, turnId: string, attempt: number): string {
  if (!CHAT_TURN_ID_PATTERN.test(turnId)) throw new Error("Invalid chat turn ID");
  if (!Number.isInteger(attempt) || attempt < 2 || attempt > 100) throw new Error("Invalid chat attempt");
  return deterministicMessageUuid(`baby-panel-chat-message\0${ownerId}\0${sessionId}\0retry-claim\0${turnId.toLowerCase()}\0${attempt}`);
}

const MAX_RETRY_CONTEXT_BYTES = 128 * 1024;

export function makeChatTurnRequestToolsJson(
  turnId: string,
  fingerprint?: string,
  retryContext?: { contextDetailPresent: boolean; contextDetail?: unknown },
): string {
  if (!CHAT_TURN_ID_PATTERN.test(turnId)) throw new Error("Invalid chat turn ID");
  const marker: Record<string, unknown> = {
    type: "llm_turn_request",
    role: "user",
    turnId: turnId.toLowerCase(),
    ...(fingerprint ? { fingerprint } : {}),
  };
  if (retryContext) {
    marker.contextDetailPresent = retryContext.contextDetailPresent;
    if (!retryContext.contextDetailPresent) {
      marker.contextDetailStored = true;
    } else {
      const encoded = JSON.stringify(retryContext.contextDetail);
      if (encoded !== undefined && Buffer.byteLength(encoded, "utf8") <= MAX_RETRY_CONTEXT_BYTES) {
        marker.contextDetail = retryContext.contextDetail;
        marker.contextDetailStored = true;
      } else {
        marker.contextDetailStored = false;
      }
    }
  }
  return JSON.stringify([marker]);
}

export function makeChatRetryClaimToolsJson(turnId: string, attempt: number): string {
  if (!CHAT_TURN_ID_PATTERN.test(turnId) || !Number.isInteger(attempt) || attempt < 2) throw new Error("Invalid chat retry claim");
  return JSON.stringify([{ type: "llm_retry_claim", role: "system", turnId: turnId.toLowerCase(), attempt }]);
}

export function readChatTurnRequest(tools: unknown): { turnId: string; fingerprint?: string } | undefined {
  if (!Array.isArray(tools)) return undefined;
  const entry = [...tools].reverse().find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "llm_turn_request") as { turnId?: unknown; fingerprint?: unknown } | undefined;
  if (typeof entry?.turnId !== "string" || !CHAT_TURN_ID_PATTERN.test(entry.turnId)) return undefined;
  return { turnId: entry.turnId.toLowerCase(), ...(typeof entry.fingerprint === "string" ? { fingerprint: entry.fingerprint } : {}) };
}

/** Restore only request context explicitly persisted on the owned user message. */
export function readChatRetryContext(tools: unknown): ChatRetryContext | undefined {
  if (!Array.isArray(tools)) return undefined;
  const entry = [...tools].reverse().find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "llm_turn_request") as Record<string, unknown> | undefined;
  if (typeof entry?.contextDetailPresent !== "boolean" || typeof entry.contextDetailStored !== "boolean") return undefined;
  if (!entry.contextDetailStored) return { available: false };
  return entry.contextDetailPresent
    ? { available: true, contextDetail: entry.contextDetail }
    : { available: true };
}

/** Unknown tools are treated conservatively: only explicit read-only names are safe to replay. */
export function isPotentialWriteTool(name: string): boolean {
  if (WRITE_TOOLS.has(name)) return true;
  if (/^(get|query|search|list|find|fetch|lookup|recommend)_/i.test(name)) return false;
  return true;
}

export function makeChatToolsJson(
  toolTraces: unknown[],
  options: { llm?: ChatLlmModelInfo; turn?: ChatTurnReceipt },
): string | null {
  const entries: unknown[] = [...toolTraces];
  if (options.llm) entries.push({ type: "llm_model", llm: options.llm } satisfies ChatLlmModelReceipt);
  if (options.turn) entries.push(options.turn);
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

export function readChatTurnReceipt(tools: unknown): ChatTurnReceipt | undefined {
  if (!Array.isArray(tools)) return undefined;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const item = tools[i] as Partial<ChatTurnReceipt> | null;
    if (item?.type === "llm_turn" && typeof item.turnId === "string" && typeof item.status === "string") {
      return item as ChatTurnReceipt;
    }
  }
  return undefined;
}

export function readChatLlmModelInfo(tools: unknown): ChatLlmModelInfo | undefined {
  if (!Array.isArray(tools)) return undefined;
  for (let i = tools.length - 1; i >= 0; i -= 1) {
    const item = tools[i] as Partial<ChatLlmModelReceipt> | null;
    const llm = item?.type === "llm_model" ? item.llm : undefined;
    if (
      llm &&
      (llm.source === "api" || llm.source === "chatgpt") &&
      typeof llm.provider === "string" &&
      typeof llm.model === "string"
    ) {
      return llm as ChatLlmModelInfo;
    }
  }
  return undefined;
}

export function withoutChatMetadata<T>(tools: T[]): T[] {
  return tools.filter((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const type = (entry as { type?: unknown }).type;
    return type !== "llm_model" && type !== "llm_turn" && type !== "llm_turn_request" && type !== "llm_retry_claim";
  });
}

import { randomUUID } from "node:crypto";
import { BridgeError, type BridgeFetch, pathId, requireData } from "./bridge-protocol";

export interface BffAiChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  image?: string | null;
  toolsJson?: string | null;
  createdAt: string;
}
export interface BffAiSession {
  id: string;
  userId: string;
  babyId: string | null;
  title: string;
  contextType: string;
  createdAt: string;
  updatedAt: string;
  messages: BffAiChatMessage[];
  messageCount: number;
  lastMessage: BffAiChatMessage | null;
}
export interface CreateAiSessionInput {
  userId: string;
  babyId?: string | null;
  title?: string;
  contextType?: string;
  accessToken?: string;
}
export interface ListAiSessionsOptions {
  babyId?: string | null;
  contextType?: string | null;
  limit?: number;
  offset?: number;
  accessToken?: string;
}
const endpoint = "/api/v1/web/ai/sessions";
export function requireAccessToken(value?: string): string {
  if (!value?.trim()) throw new BridgeError(401, "BFF_SESSION_REQUIRED", "请重新登录后重试");
  return value;
}
function invalid(): never {
  throw new BridgeError(502, "UPSTREAM_INVALID_AI_SESSION", "GrowDesk 返回了不完整或归属不符的会话");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function messageDto(value: unknown, sessionId: string): BffAiChatMessage {
  const row = object(value);
  if (typeof row.id !== "string" || !row.id || row.sessionId !== sessionId ||
      !["user", "assistant", "system"].includes(String(row.role)) ||
      typeof row.content !== "string" || !validTime(row.createdAt) ||
      (row.image != null && typeof row.image !== "string") ||
      (row.toolsJson != null && typeof row.toolsJson !== "string")) return invalid();
  return row as unknown as BffAiChatMessage;
}
function sessionDto(value: unknown, userId: string, id?: string): BffAiSession {
  const row = object(value);
  if (typeof row.id !== "string" || !row.id || (id && row.id !== id) || row.userId !== userId ||
      (row.babyId !== null && typeof row.babyId !== "string") ||
      typeof row.title !== "string" || typeof row.contextType !== "string" ||
      !validTime(row.createdAt) || !validTime(row.updatedAt) || !Array.isArray(row.messages) ||
      !Number.isSafeInteger(row.messageCount) || Number(row.messageCount) < row.messages.length ||
      !(row.lastMessage === null || typeof row.lastMessage === "object")) return invalid();
  const messages = row.messages.map(message => messageDto(message, row.id as string));
  if (new Set(messages.map(message => message.id)).size !== messages.length) return invalid();
  return {
    ...(row as unknown as BffAiSession), messages,
    lastMessage: row.lastMessage === null ? null : messageDto(row.lastMessage, row.id),
  };
}

/** Stateless adapter: the backend is the only authority, including after errors or restarts. */
export function createAiSessionClient(fetchApi: BridgeFetch) {
  return {
    async createSession(input: CreateAiSessionInput, token?: string): Promise<BffAiSession> {
      const result = await fetchApi<unknown>(endpoint, {
        method: "POST", accessToken: requireAccessToken(token || input.accessToken),
        body: { babyId: input.babyId ?? null, title: input.title, contextType: input.contextType },
      });
      return sessionDto(requireData(result), input.userId);
    },
    async listSessions(userId: string, options: ListAiSessionsOptions = {}) {
      const query = new URLSearchParams();
      if (options.babyId) query.set("babyId", options.babyId);
      if (options.contextType) query.set("contextType", options.contextType);
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.offset !== undefined) query.set("offset", String(options.offset));
      const raw = object(requireData(await fetchApi<unknown>(`${endpoint}?${query}`, {
        accessToken: requireAccessToken(options.accessToken),
      })));
      if (!Number.isSafeInteger(raw.total) || Number(raw.total) < 0 || !Array.isArray(raw.sessions)) return invalid();
      return { total: Number(raw.total), sessions: raw.sessions.map(row => sessionDto(row, userId)) };
    },
    async getSession(id: string, userId: string,
      optionsOrToken: string | { babyId?: string | null; contextType?: string | null; accessToken?: string } = {},
    ): Promise<BffAiSession | null> {
      const options = typeof optionsOrToken === "string" ? { accessToken: optionsOrToken } : optionsOrToken;
      const result = await fetchApi<unknown>(`${endpoint}/${pathId(id)}`, { accessToken: requireAccessToken(options.accessToken) });
      if (!result.ok && result.status === 404) return null;
      const session = sessionDto(requireData(result), userId, id);
      if ((options.babyId && session.babyId !== options.babyId) ||
          (options.contextType && session.contextType !== options.contextType)) {
        throw new BridgeError(409, "AI_SESSION_CONTEXT_MISMATCH", "会话所属宝宝或领域与当前请求不匹配");
      }
      return session;
    },
    async updateSessionTitle(id: string, userId: string, title: string, token?: string): Promise<BffAiSession | null> {
      const result = await fetchApi<unknown>(`${endpoint}/${pathId(id)}`, {
        method: "PATCH", accessToken: requireAccessToken(token), body: { title },
      });
      if (!result.ok && result.status === 404) return null;
      return sessionDto(requireData(result), userId, id);
    },
    async deleteSession(id: string, _userId: string, token?: string): Promise<boolean> {
      const result = await fetchApi<unknown>(`${endpoint}/${pathId(id)}`, {
        method: "DELETE", accessToken: requireAccessToken(token),
      });
      if (!result.ok && result.status === 404) return false;
      if (object(requireData(result)).deleted !== true) return invalid();
      return true;
    },
    async addMessage(id: string, _userId: string,
      message: { role: "user" | "assistant" | "system"; content: string; image?: string | null; toolsJson?: string | null; id?: string },
      token?: string,
    ): Promise<BffAiChatMessage | null> {
      const result = await fetchApi<unknown>(`${endpoint}/${pathId(id)}/messages`, {
        method: "POST", accessToken: requireAccessToken(token), body: { ...message, id: message.id ?? randomUUID() },
      });
      if (!result.ok && result.status === 404) return null;
      return messageDto(requireData(result), id);
    },
  };
}

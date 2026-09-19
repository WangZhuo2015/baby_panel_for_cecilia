import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch, type GrowDeskFetchOptions } from "./client";
import { BridgeError, requireData } from "./bridge-protocol";

const SESSION_PATH = "/api/v1/web/ai/sessions";
async function remote<T>(pathname: string, accessToken: string | undefined, options: GrowDeskFetchOptions = {}): Promise<T> {
  if (!accessToken) throw new BridgeError(401, "SESSION_REQUIRED", "GrowDesk 会话凭证缺失");
  return requireData(await growdeskFetch<T>(pathname, { ...options, accessToken }));
}


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

const DATA_DIR = path.resolve(process.cwd(), ".data");
const SESSIONS_FILE = path.join(DATA_DIR, "growdesk-ai-sessions.json");

class BffAiSessionStore {
  private sessions = new Map<string, BffAiSession>();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
        const list: BffAiSession[] = JSON.parse(raw);
        for (const s of list) {
          this.sessions.set(s.id, s);
        }
      }
    } catch {
      // Ignore initial file read error, fallback to memory
    }
  }

  private persist(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const list = Array.from(this.sessions.values());
      const tmpFile = `${SESSIONS_FILE}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), "utf-8");
      fs.renameSync(tmpFile, SESSIONS_FILE);
    } catch {
      // Persist failure does not block request
    }
  }

  public async createSession(input: CreateAiSessionInput, accessToken?: string): Promise<BffAiSession> {
    if (GROWDESK_CONFIG.enabled) {
      return remote<BffAiSession>(SESSION_PATH, accessToken || input.accessToken, {
        method: "POST",
        body: {
          babyId: input.babyId || null,
          title: input.title?.trim().slice(0, 50) || "新对话",
          contextType: input.contextType?.trim() || "general",
        },
      });
    }
    this.ensureLoaded();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const session: BffAiSession = {
      id,
      userId: input.userId,
      babyId: input.babyId || null,
      title: input.title && input.title.trim() ? input.title.trim().slice(0, 50) : "新对话",
      contextType: input.contextType && input.contextType.trim() ? input.contextType.trim() : "general",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  public async listSessions(
    userId: string,
    options: ListAiSessionsOptions = {}
  ): Promise<{ total: number; sessions: Array<BffAiSession & { messageCount: number; lastMessage: any | null }> }> {
    if (GROWDESK_CONFIG.enabled) {
      const query = new URLSearchParams();
      if (options.babyId) query.set("babyId", options.babyId);
      if (options.contextType) query.set("contextType", options.contextType);
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      if (options.offset !== undefined) query.set("offset", String(options.offset));
      return remote(`${SESSION_PATH}${query.size ? `?${query}` : ""}`, options.accessToken);
    }
    this.ensureLoaded();

    let all = Array.from(this.sessions.values()).filter((s) => s.userId === userId);
    if (options.babyId) {
      all = all.filter((s) => s.babyId === options.babyId);
    }
    if (options.contextType) {
      all = all.filter((s) => s.contextType === options.contextType);
    }

    all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const total = all.length;
    const offset = options.offset || 0;
    const limit = options.limit || 30;
    const page = all.slice(offset, offset + limit);

    const formatted = page.map((s) => {
      const lastMsg = s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1] : null;
      return {
        ...s,
        messageCount: s.messages ? s.messages.length : 0,
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              role: lastMsg.role,
              content: lastMsg.content.slice(0, 100),
              createdAt: lastMsg.createdAt,
            }
          : null,
      };
    });

    return { total, sessions: formatted };
  }

  public async getSession(
    sessionId: string,
    userId: string,
    optionsOrToken: string | { babyId?: string | null; contextType?: string | null; accessToken?: string } = {}
  ): Promise<BffAiSession | null> {
    const options = typeof optionsOrToken === "string" ? { accessToken: optionsOrToken } : optionsOrToken;
    if (GROWDESK_CONFIG.enabled) {
      try {
        return await remote<BffAiSession>(`${SESSION_PATH}/${encodeURIComponent(sessionId)}`, options.accessToken);
      } catch (error) {
        if (error instanceof BridgeError && error.status === 404) return null;
        throw error;
      }
    }
    this.ensureLoaded();
    const session = this.sessions.get(sessionId);

    if (!session || session.userId !== userId) {
      return null;
    }

    return session;
  }

  public async updateSessionTitle(
    sessionId: string,
    userId: string,
    title: string,
    accessToken?: string
  ): Promise<BffAiSession | null> {
    if (GROWDESK_CONFIG.enabled) {
      try {
        return await remote<BffAiSession>(`${SESSION_PATH}/${encodeURIComponent(sessionId)}`, accessToken, {
          method: "PATCH", body: { title: title.trim().slice(0, 50) || "新对话" },
        });
      } catch (error) {
        if (error instanceof BridgeError && error.status === 404) return null;
        throw error;
      }
    }
    this.ensureLoaded();
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    session.title = title.trim().slice(0, 50);
    session.updatedAt = new Date().toISOString();
    this.persist();
    return session;
  }

  public async deleteSession(
    sessionId: string,
    userId: string,
    accessToken?: string
  ): Promise<boolean> {
    if (GROWDESK_CONFIG.enabled) {
      try {
        return (await remote<{ deleted: boolean }>(`${SESSION_PATH}/${encodeURIComponent(sessionId)}`, accessToken, { method: "DELETE" })).deleted;
      } catch (error) {
        if (error instanceof BridgeError && error.status === 404) return false;
        throw error;
      }
    }
    this.ensureLoaded();
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    this.sessions.delete(sessionId);
    this.persist();
    return true;
  }

  public async addMessage(
    sessionId: string,
    userId: string,
    message: {
      role: "user" | "assistant" | "system";
      content: string;
      image?: string | null;
      toolsJson?: string | null;
      id?: string;
    },
    accessToken?: string
  ): Promise<BffAiChatMessage | null> {
    if (GROWDESK_CONFIG.enabled) {
      return remote<BffAiChatMessage>(`${SESSION_PATH}/${encodeURIComponent(sessionId)}/messages`, accessToken, {
        method: "POST", body: { ...message, id: message.id || crypto.randomUUID() },
      });
    }
    this.ensureLoaded();
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }

    const msg: BffAiChatMessage = {
      id: message.id || crypto.randomUUID(),
      sessionId,
      role: message.role,
      content: message.content,
      image: message.image || null,
      toolsJson: message.toolsJson || null,
      createdAt: new Date().toISOString(),
    };

    if (!session.messages) {
      session.messages = [];
    }
    session.messages.push(msg);
    session.updatedAt = msg.createdAt;
    this.persist();
    return msg;
  }

  public clearAllForTest(): void {
    this.sessions.clear();
    this.loaded = true;
    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        fs.unlinkSync(SESSIONS_FILE);
      }
    } catch {}
  }
}

const globalForSessions = globalThis as unknown as {
  __bffAiSessionStore?: BffAiSessionStore;
};

export const bffAiSessionStore =
  globalForSessions.__bffAiSessionStore ??
  (globalForSessions.__bffAiSessionStore = new BffAiSessionStore());

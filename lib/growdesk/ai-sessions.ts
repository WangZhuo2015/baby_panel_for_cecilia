import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "./client";

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
    this.ensureLoaded();

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const token = accessToken || input.accessToken;
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

    // If GrowDesk server is configured and accessToken is present, try remote session create
    if (token) {
      try {
        const res = await growdeskFetch<{ id: string; userId: string; babyId: string | null; title: string }>(
          "/api/v1/ai/sessions",
          {
            method: "POST",
            accessToken: token,
            body: {
              babyId: session.babyId,
              title: session.title,
            },
          }
        );
        if (res.ok && res.data?.id) {
          session.id = res.data.id;
        }
      } catch {
        // Fallback to local generated id
      }
    }

    this.sessions.set(session.id, session);
    this.persist();
    return session;
  }

  public async listSessions(
    userId: string,
    options: ListAiSessionsOptions = {}
  ): Promise<{ total: number; sessions: Array<BffAiSession & { messageCount: number; lastMessage: any | null }> }> {
    this.ensureLoaded();

    // If GrowDesk server is available and accessToken is provided, query remote sessions
    if (options.accessToken) {
      try {
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.set("limit", String(options.limit));
        const res = await growdeskFetch<Array<{ id: string; userId: string; babyId: string | null; title: string; createdAt: string; updatedAt: string }>>(
          `/api/v1/ai/sessions?${queryParams.toString()}`,
          { accessToken: options.accessToken }
        );
        if (res.ok && Array.isArray(res.data)) {
          for (const item of res.data) {
            if (!this.sessions.has(item.id)) {
              this.sessions.set(item.id, {
                id: item.id,
                userId: item.userId || userId,
                babyId: item.babyId,
                title: item.title,
                contextType: "general",
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                messages: [],
              });
            }
          }
        }
      } catch {}
    }

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
    this.ensureLoaded();
    const options = typeof optionsOrToken === "string" ? { accessToken: optionsOrToken } : optionsOrToken;

    let session = this.sessions.get(sessionId);

    // If not found locally, try fetching messages from GrowDesk
    if (!session && options.accessToken) {
      try {
        const res = await growdeskFetch<Array<{ id: string; role: string; content: string; createdAt: string }>>(
          `/api/v1/ai/sessions/${sessionId}/messages`,
          { accessToken: options.accessToken }
        );
        if (res.ok && Array.isArray(res.data)) {
          const now = new Date().toISOString();
          session = {
            id: sessionId,
            userId,
            babyId: options.babyId || null,
            title: "对话",
            contextType: options.contextType || "general",
            createdAt: now,
            updatedAt: now,
            messages: res.data.map((m) => ({
              id: m.id,
              sessionId,
              role: m.role as any,
              content: m.content,
              createdAt: m.createdAt,
            })),
          };
          this.sessions.set(sessionId, session);
          this.persist();
        }
      } catch {}
    }

    if (!session || session.userId !== userId) {
      return null;
    }

    return session;
  }

  public async updateSessionTitle(
    sessionId: string,
    userId: string,
    title: string,
    _accessToken?: string
  ): Promise<BffAiSession | null> {
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
    _accessToken?: string
  ): Promise<boolean> {
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
    _accessToken?: string
  ): Promise<BffAiChatMessage | null> {
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

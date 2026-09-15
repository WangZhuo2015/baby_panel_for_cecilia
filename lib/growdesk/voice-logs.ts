import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface BffVoiceLog {
  id: string;
  userId: string;
  babyId: string;
  prompt: string;
  reply: string;
  isAsync: boolean;
  isFastPath: boolean;
  acknowledged: boolean;
  createdAt: string;
  baby?: {
    id: string;
    nickname: string;
    gender?: string;
  } | null;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const VOICE_LOGS_FILE = path.join(DATA_DIR, "growdesk-voice-logs.json");

class BffVoiceLogStore {
  private logs = new Map<string, BffVoiceLog>();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(VOICE_LOGS_FILE)) {
        const raw = fs.readFileSync(VOICE_LOGS_FILE, "utf-8");
        const list: BffVoiceLog[] = JSON.parse(raw);
        for (const log of list) {
          this.logs.set(log.id, log);
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
      const list = Array.from(this.logs.values());
      const tmpFile = `${VOICE_LOGS_FILE}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), "utf-8");
      fs.renameSync(tmpFile, VOICE_LOGS_FILE);
    } catch {
      // Persist failure does not crash process
    }
  }

  public createLog(data: {
    userId: string;
    babyId: string;
    prompt: string;
    reply: string;
    isAsync?: boolean;
    isFastPath?: boolean;
    acknowledged?: boolean;
    baby?: { id: string; nickname: string; gender?: string } | null;
  }): BffVoiceLog {
    this.ensureLoaded();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const log: BffVoiceLog = {
      id,
      userId: data.userId,
      babyId: data.babyId,
      prompt: data.prompt,
      reply: data.reply,
      isAsync: Boolean(data.isAsync),
      isFastPath: Boolean(data.isFastPath),
      acknowledged: Boolean(data.acknowledged),
      createdAt: now,
      baby: data.baby || null,
    };
    this.logs.set(id, log);
    this.persist();
    return log;
  }

  public listLogs(
    userId: string,
    options: { limit?: number; unreadAsyncOnly?: boolean } = {}
  ): { logs: BffVoiceLog[]; unreadLog?: BffVoiceLog | null } {
    this.ensureLoaded();
    const limit = Math.min(options.limit || 20, 50);
    const userLogs = Array.from(this.logs.values())
      .filter((l) => l.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (options.unreadAsyncOnly) {
      const since24h = Date.now() - 24 * 60 * 60 * 1000;
      const unreadLog =
        userLogs.find(
          (l) => l.isAsync && !l.acknowledged && new Date(l.createdAt).getTime() >= since24h
        ) || null;
      return { logs: [], unreadLog };
    }

    return { logs: userLogs.slice(0, limit) };
  }

  public getLog(id: string, userId: string): BffVoiceLog | null {
    this.ensureLoaded();
    const log = this.logs.get(id);
    if (!log || log.userId !== userId) {
      return null;
    }
    return log;
  }

  public acknowledgeLog(id: string, userId: string, acknowledged: boolean): boolean {
    this.ensureLoaded();
    const log = this.logs.get(id);
    if (!log || log.userId !== userId) {
      return false;
    }
    log.acknowledged = acknowledged;
    this.persist();
    return true;
  }

  public clearAllForTest(): void {
    this.logs.clear();
    this.loaded = true;
    try {
      if (fs.existsSync(VOICE_LOGS_FILE)) {
        fs.unlinkSync(VOICE_LOGS_FILE);
      }
    } catch {}
  }
}

const globalForVoiceLogs = globalThis as unknown as {
  __bffVoiceLogStore?: BffVoiceLogStore;
};

export const bffVoiceLogStore =
  globalForVoiceLogs.__bffVoiceLogStore ??
  (globalForVoiceLogs.__bffVoiceLogStore = new BffVoiceLogStore());

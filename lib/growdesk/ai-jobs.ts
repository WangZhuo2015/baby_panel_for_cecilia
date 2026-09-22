import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type BffJobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface BffAiJob {
  id: string;
  userId: string;
  familyId?: string | null;
  babyId?: string | null;
  type: string;
  status: BffJobStatus;
  resultJson?: string | null;
  errorMessage?: string | null;
  imageUrl?: string | null;
  claimed: boolean;
  inputArchiveId?: string | null;
  idempotencyKey?: string | null;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface CreateAiJobInput {
  userId: string;
  familyId?: string | null;
  babyId?: string | null;
  type: string;
  imageUrl?: string | null;
  inputArchiveId?: string | null;
  idempotencyKey?: string | null;
  maxAttempts?: number;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const JOBS_FILE = path.join(DATA_DIR, "growdesk-ai-jobs.json");
const TIMEOUT_MS = 180_000; // 3 minutes timeout

class BffAiJobStore {
  private jobs = new Map<string, BffAiJob>();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(JOBS_FILE)) {
        const raw = fs.readFileSync(JOBS_FILE, "utf-8");
        const list: BffAiJob[] = JSON.parse(raw);
        for (const j of list) {
          this.jobs.set(j.id, j);
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
      const list = Array.from(this.jobs.values());
      const tmpFile = `${JOBS_FILE}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), "utf-8");
      fs.renameSync(tmpFile, JOBS_FILE);
    } catch {
      // Persist failure does not crash process
    }
  }

  public createJob(input: CreateAiJobInput): BffAiJob {
    this.ensureLoaded();

    // Idempotency check: prevent duplicate billing or duplicate executions
    if (input.idempotencyKey) {
      for (const existing of this.jobs.values()) {
        if (
          existing.userId === input.userId &&
          existing.type === input.type &&
          existing.idempotencyKey === input.idempotencyKey
        ) {
          // If already succeeded or still running/pending, return existing
          if (["pending", "running", "succeeded"].includes(existing.status)) {
            return existing;
          }
        }
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: BffAiJob = {
      id,
      userId: input.userId,
      familyId: input.familyId || null,
      babyId: input.babyId || null,
      type: input.type,
      status: "running", // starts in running (or pending)
      resultJson: null,
      errorMessage: null,
      imageUrl: input.imageUrl || null,
      claimed: false,
      inputArchiveId: input.inputArchiveId || null,
      idempotencyKey: input.idempotencyKey || null,
      attempt: 1,
      maxAttempts: input.maxAttempts || 3,
      createdAt: now,
      startedAt: now,
      finishedAt: null,
    };

    this.jobs.set(id, job);
    this.persist();
    return job;
  }

  public getJob(jobId: string, userId: string): BffAiJob | null {
    this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    // Timeout watchdog: auto-mark failed if running > 3 minutes
    if (job.status === "running") {
      const elapsed = Date.now() - new Date(job.startedAt || job.createdAt).getTime();
      if (elapsed > TIMEOUT_MS) {
        job.status = "failed";
        job.errorMessage = "AI 识别任务响应超时，请重新拍摄更清晰的照片并上传";
        job.finishedAt = new Date().toISOString();
        this.persist();
      }
    }

    return job;
  }

  public listJobs(
    userId: string,
    options: { type?: string; limit?: number } = {}
  ): { pendingClaim: number; jobs: BffAiJob[] } {
    this.ensureLoaded();

    const limit = Math.min(options.limit || 10, 50);
    const now = Date.now();

    const userJobs = Array.from(this.jobs.values())
      .filter((j) => j.userId === userId && (!options.type || j.type === options.type))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Watchdog check for list
    for (const j of userJobs) {
      if (j.status === "running" && now - new Date(j.startedAt || j.createdAt).getTime() > TIMEOUT_MS) {
        j.status = "failed";
        j.errorMessage = "AI 识别任务响应超时，请重新拍摄更清晰的照片并上传";
        j.finishedAt = new Date().toISOString();
      }
    }
    this.persist();

    const pendingClaim = userJobs.filter((j) => j.status === "succeeded" && !j.claimed).length;
    return {
      pendingClaim,
      jobs: userJobs.slice(0, limit),
    };
  }

  public updateJob(
    jobId: string,
    userId: string,
    update: {
      status?: BffJobStatus;
      resultJson?: string | null;
      errorMessage?: string | null;
      finishedAt?: string | null;
    }
  ): BffAiJob | null {
    this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }

    if (update.status) job.status = update.status;
    if (update.resultJson !== undefined) job.resultJson = update.resultJson;
    if (update.errorMessage !== undefined) job.errorMessage = update.errorMessage;
    if (update.finishedAt !== undefined) job.finishedAt = update.finishedAt;
    else if (update.status === "succeeded" || update.status === "failed" || update.status === "cancelled") {
      job.finishedAt = new Date().toISOString();
    }

    this.persist();
    return job;
  }

  public claimJob(jobId: string, userId: string): boolean {
    this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return false;
    }
    job.claimed = true;
    this.persist();
    return true;
  }

  public cancelJob(jobId: string, userId: string): boolean {
    this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return false;
    }
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return false;
    }
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    this.persist();
    return true;
  }

  public retryJob(jobId: string, userId: string): BffAiJob | null {
    this.ensureLoaded();
    const job = this.jobs.get(jobId);
    if (!job || job.userId !== userId) {
      return null;
    }
    if (job.status !== "failed" && job.status !== "cancelled") {
      return null;
    }
    if (job.attempt >= job.maxAttempts) {
      return null;
    }

    job.attempt += 1;
    job.startedAt = new Date().toISOString();
    job.status = "running";
    job.errorMessage = null;
    job.finishedAt = null;
    this.persist();
    return job;
  }

  public clearAllForTest(): void {
    this.jobs.clear();
    this.loaded = true;
    try {
      if (fs.existsSync(JOBS_FILE)) {
        fs.unlinkSync(JOBS_FILE);
      }
    } catch {}
  }
}

const globalForJobs = globalThis as unknown as {
  __bffAiJobStore?: BffAiJobStore;
};

export const bffAiJobStore =
  globalForJobs.__bffAiJobStore ?? (globalForJobs.__bffAiJobStore = new BffAiJobStore());

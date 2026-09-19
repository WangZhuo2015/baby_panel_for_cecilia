/**
 * 离线提交队列（outbox）：IndexedDB 持久化待同步记录。
 * 具备身份隔离（userId / familyId / babyId 绑定）、幂等去重、
 * 409 冲突原稿保留、显式孤儿队列接管与恢复、事务提交保证。
 */

const DB_NAME = "baby-panel-outbox";
const STORE = "pending";
const VERSION = 2;

export interface OutboxError {
  status?: number;
  code?: string;
  message: string;
  timestamp: number;
}

export type OutboxStatus = "pending" | "conflict" | "error";

export interface OutboxEntry {
  clientId: string;
  url: string;
  body: Record<string, unknown>;
  createdAt: number;
  userId?: string | null;
  familyId?: string | null;
  babyId?: string | null;
  status?: OutboxStatus;
  error?: OutboxError | null;
  retryCount?: number;
}

export interface ListOutboxOptions {
  userId?: string | null;
  includeUnowned?: boolean;
}

export interface FlushOptions {
  activeUserId?: string | null;
  activeFamilyId?: string | null;
  activeBabyId?: string | null;
}

export interface FlushResult {
  flushed: number;
  skippedOtherUser: number;
  skippedOtherScope: number;
  conflicts: number;
  errors: number;
}

function normalizeEntry(raw: any): OutboxEntry {
  return {
    clientId: String(raw.clientId),
    url: String(raw.url),
    body: raw.body && typeof raw.body === "object" ? raw.body : {},
    createdAt: Number(raw.createdAt) || Date.now(),
    userId: raw.userId ?? null,
    familyId: raw.familyId ?? null,
    babyId: raw.babyId ?? null,
    status: raw.status === "conflict" || raw.status === "error" ? raw.status : "pending",
    error: raw.error ?? null,
    retryCount: Number(raw.retryCount) || 0,
  };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: "clientId" });
      } else {
        store = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE);
      }
      if (!store.indexNames.contains("userId")) {
        store.createIndex("userId", "userId", { unique: false });
      }
      if (!store.indexNames.contains("status")) {
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result: T;
    let requestError: DOMException | Error | null = null;

    try {
      const req = fn(tx.objectStore(STORE));
      if (req) {
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => {
          requestError = req.error;
        };
      }
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(requestError || tx.error || new Error("IndexedDB transaction failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(requestError || tx.error || new Error("IndexedDB transaction aborted"));
    };
  });
}

export async function enqueueOutbox(entry: OutboxEntry): Promise<void> {
  const normalized = normalizeEntry(entry);
  await withStore("readwrite", (s) => s.put(normalized));
}

export async function removePending(clientId: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(clientId));
}

export async function listPending(options?: ListOutboxOptions): Promise<OutboxEntry[]> {
  try {
    const items = await withStore<OutboxEntry[]>("readonly", (s) => s.getAll());
    let list = (items ?? []).map(normalizeEntry);
    if (options?.userId !== undefined) {
      list = list.filter((item) => {
        if (item.userId === options.userId) return true;
        if (options.includeUnowned && !item.userId) return true;
        return false;
      });
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function getOrphanEntries(): Promise<OutboxEntry[]> {
  const all = await listPending();
  return all.filter((item) => !item.userId);
}

export async function claimOrphanEntries(
  targetUserId: string,
  targetFamilyId?: string | null,
  targetBabyId?: string | null
): Promise<number> {
  if (!targetUserId) throw new Error("targetUserId required");
  const orphans = await getOrphanEntries();
  for (const orphan of orphans) {
    orphan.userId = targetUserId;
    if (targetFamilyId) orphan.familyId = targetFamilyId;
    if (targetBabyId) orphan.babyId = targetBabyId;
    orphan.status = "pending";
    orphan.error = null;
    await enqueueOutbox(orphan);
  }
  return orphans.length;
}

export async function updateEntryStatus(
  clientId: string,
  status: OutboxStatus,
  error?: OutboxError | null
): Promise<void> {
  try {
    const item = await withStore<OutboxEntry | undefined>("readonly", (s) => s.get(clientId));
    if (item) {
      item.status = status;
      item.error = error ?? null;
      await withStore("readwrite", (s) => s.put(item));
    }
  } catch {}
}

export async function recordRetry(
  clientId: string,
  error?: OutboxError | null
): Promise<void> {
  try {
    const item = await withStore<OutboxEntry | undefined>("readonly", (s) => s.get(clientId));
    if (item) {
      item.retryCount = (item.retryCount || 0) + 1;
      item.error = error ?? null;
      await withStore("readwrite", (s) => s.put(item));
    }
  } catch {}
}

/** 判定一个错误是否值得进 outbox（网络层失败或服务端 5xx），4xx 校验类错误直接抛给用户 */
export function isRetryableSubmitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    e instanceof TypeError ||
    /Failed to fetch|NetworkError|网络连接不可用/i.test(msg) ||
    /请求失败 \((50[0-9]|52\d)\)/.test(msg)
  );
}

/**
 * 重放队列。
 * - 具备身份隔离：仅重放 activeUserId 所属记录，不跨账号代发。
 * - 409 冲突保留原稿为 status: 'conflict'。
 * - 401/403 会话过期/权限撤销保留为 status: 'error'。
 * - 5xx/429/断网保留重试。
 */
export async function flushOutbox(options?: FlushOptions): Promise<FlushResult>;
export async function flushOutbox(): Promise<number>;
export async function flushOutbox(options?: FlushOptions): Promise<FlushResult | number> {
  const allItems = await listPending();
  const activeUserId = options?.activeUserId ?? null;

  const result: FlushResult = {
    flushed: 0,
    skippedOtherUser: 0,
    skippedOtherScope: 0,
    conflicts: 0,
    errors: 0,
  };

  for (const item of allItems) {
    // 1. 账号隔离：属于其他用户的草稿绝不代发
    if (item.userId && activeUserId && item.userId !== activeUserId) {
      result.skippedOtherUser += 1;
      continue;
    }
    // 未登录时有属主的草稿不发送
    if (item.userId && !activeUserId) {
      result.skippedOtherUser += 1;
      continue;
    }
    // 旧队列无 owner 时不得自动归属当前用户，需显式恢复
    if (!item.userId) {
      result.skippedOtherUser += 1;
      continue;
    }
    // A user may own multiple families/babies. Keep a queued write bound to
    // the scope that was active when it was created; switching the UI must
    // never replay another baby's draft under the new active scope.
    if (
      (options?.activeFamilyId !== undefined && options.activeFamilyId !== null && item.familyId !== options.activeFamilyId) ||
      (options?.activeBabyId !== undefined && options.activeBabyId !== null && item.babyId !== options.activeBabyId)
    ) {
      result.skippedOtherScope += 1;
      continue;
    }
    // 已处于冲突状态的记录不重复自动提交，等待用户显式处理
    if (item.status === "conflict") {
      result.conflicts += 1;
      continue;
    }

    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": item.clientId,
        },
        body: JSON.stringify(item.body),
      });

      if (res.ok) {
        await removePending(item.clientId);
        result.flushed += 1;
      } else if (res.status === 409) {
        // 409 并发冲突：保留原稿，绝不静默删除！
        let errMessage = "记录版本冲突 (409)";
        try {
          const data = await res.json();
          if (data?.error) errMessage = data.error;
        } catch {}
        await updateEntryStatus(item.clientId, "conflict", {
          status: 409,
          code: "CONFLICT",
          message: errMessage,
          timestamp: Date.now(),
        });
        result.conflicts += 1;
      } else if (res.status === 401 || res.status === 403) {
        // 授权过期或家庭权限撤销：保留原稿，标记 error
        let errMessage = res.status === 401 ? "登录会话已过期 (401)" : "无权访问此家庭或宝宝 (403)";
        try {
          const data = await res.json();
          if (data?.error) errMessage = data.error;
        } catch {}
        await updateEntryStatus(item.clientId, "error", {
          status: res.status,
          code: res.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
          message: errMessage,
          timestamp: Date.now(),
        });
        result.errors += 1;
        break; // 停止当前批次
      } else if (res.status === 429 || res.status >= 500) {
        // 5xx 或 429 临时错误：保留重试
        let errMessage = `上游暂时不可用 (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) errMessage = data.error;
        } catch {}
        await recordRetry(item.clientId, {
          status: res.status,
          code: "SERVER_ERROR",
          message: errMessage,
          timestamp: Date.now(),
        });
        result.errors += 1;
        break;
      } else {
        // 400, 422 等格式错误：保留草稿让用户查看和修正
        let errMessage = `请求参数错误 (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) errMessage = data.error;
        } catch {}
        await updateEntryStatus(item.clientId, "error", {
          status: res.status,
          code: "CLIENT_ERROR",
          message: errMessage,
          timestamp: Date.now(),
        });
        result.errors += 1;
      }
    } catch {
      break; // 断网暂停
    }
  }

  return options !== undefined ? result : result.flushed;
}

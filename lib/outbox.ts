/**
 * 离线提交队列（outbox）：IndexedDB 持久化待同步记录。
 * 断网时入队 → 联网后自动重放；服务端以 clientId 幂等去重。
 */

const DB_NAME = "baby-panel-outbox";
const STORE = "pending";
const VERSION = 1;

export interface OutboxEntry {
  clientId: string;
  url: string;
  body: Record<string, unknown>;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "clientId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function enqueueOutbox(entry: OutboxEntry): Promise<void> {
  await withStore("readwrite", (s) => s.put(entry));
}

export async function removePending(clientId: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(clientId));
}

export async function listPending(): Promise<OutboxEntry[]> {
  try {
    const items = await withStore<OutboxEntry[]>("readonly", (s) => s.getAll());
    return (items ?? []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
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
 * 重放队列。返回成功同步的条数；
 * 4xx（校验失败/冲突）视为永久拒绝直接丢弃，5xx/网络错误保留等待下轮。
 */
export async function flushOutbox(): Promise<number> {
  const items = await listPending();
  let flushed = 0;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await removePending(item.clientId);
        if (res.ok) flushed += 1;
      } else {
        break; // 5xx：暂停本轮，保留剩余队列
      }
    } catch {
      break;
    }
  }
  return flushed;
}

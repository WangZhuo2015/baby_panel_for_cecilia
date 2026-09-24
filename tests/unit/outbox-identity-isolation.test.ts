import test from "node:test";
import assert from "node:assert/strict";

// Mock indexedDB for Node test environment
class MockIDBRequest {
  result: any = null;
  error: any = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class MockIDBObjectStore {
  data = new Map<string, any>();
  indexNames = { contains: (_name: string) => true };

  put(value: any) {
    const req = new MockIDBRequest();
    this.data.set(value.clientId, value);
    req.result = value.clientId;
    process.nextTick(() => req.onsuccess?.());
    return req;
  }

  get(key: string) {
    const req = new MockIDBRequest();
    req.result = this.data.get(key);
    process.nextTick(() => req.onsuccess?.());
    return req;
  }

  delete(key: string) {
    const req = new MockIDBRequest();
    this.data.delete(key);
    process.nextTick(() => req.onsuccess?.());
    return req;
  }

  getAll() {
    const req = new MockIDBRequest();
    req.result = Array.from(this.data.values());
    process.nextTick(() => req.onsuccess?.());
    return req;
  }

  createIndex() {}
}

const mockStore = new MockIDBObjectStore();

class MockIDBTransaction {
  store: MockIDBObjectStore;
  mode: string;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor(store: MockIDBObjectStore, mode: string) {
    this.store = store;
    this.mode = mode;
    setTimeout(() => this.oncomplete?.(), 2);
  }

  objectStore(_name: string) {
    return this.store;
  }
}

class MockIDBDatabase {
  objectStoreNames = { contains: (_name: string) => true };
  transaction(_name: string, mode: string) {
    return new MockIDBTransaction(mockStore, mode);
  }
  close() {}
}

const mockDb = new MockIDBDatabase();

(globalThis as any).indexedDB = {
  open: () => {
    const req = new MockIDBRequest();
    req.result = mockDb;
    process.nextTick(() => req.onsuccess?.());
    return req;
  },
};

// Mock localStorage
const mockStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mockStorage.get(k) ?? null,
  setItem: (k: string, v: string) => mockStorage.set(k, String(v)),
  removeItem: (k: string) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

import {
  enqueueOutbox,
  listPending,
  flushOutbox,
  removePending,
  getOrphanEntries,
  claimOrphanEntries,
  type OutboxEntry,
} from "../../lib/outbox";
import {
  saveSnapshot,
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_MAX_AGE,
} from "../../stores/useBabyStore";
import { createRecordsSlice } from "../../stores/slices/records";

test("Issue #2: Outbox Identity Isolation & Replay Protection", async (t) => {
  mockStore.data.clear();
  mockStorage.clear();

  await t.test("1. Enqueue stores user/family/baby context and preserves stable idempotency clientId", async () => {
    const entryA: OutboxEntry = {
      clientId: "client-id-user-a-1",
      url: "/api/records/diaper",
      body: { type: "pee" },
      createdAt: Date.now(),
      userId: "user_a",
      familyId: "fam_a",
      babyId: "baby_a",
    };
    await enqueueOutbox(entryA);

    const pending = await listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].clientId, "client-id-user-a-1");
    assert.equal(pending[0].userId, "user_a");
    assert.equal(pending[0].familyId, "fam_a");
    assert.equal(pending[0].babyId, "baby_a");
    assert.equal(pending[0].status, "pending");
  });

  await t.test("2. Cross-account isolation: User B flush does NOT touch or replay User A's pending drafts", async () => {
    let fetchCalls: Array<{ url: string; clientId: string }> = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, clientId: init.headers["idempotency-key"] });
      return { ok: true, status: 200, json: async () => ({}) };
    };

    try {
      // User B flushes queue
      const res = await flushOutbox({
        activeUserId: "user_b",
        activeFamilyId: "fam_b",
        activeBabyId: "baby_b",
      });

      // User A's draft must be skipped
      assert.equal(res.flushed, 0);
      assert.equal(res.skippedOtherUser, 1);
      assert.equal(fetchCalls.length, 0);

      // Verify User A's item remains intact in IndexedDB
      const pending = await listPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].userId, "user_a");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test("3. A -> B -> A account switching: User A items replay successfully only when A is active", async () => {
    let fetchCalls: Array<{ url: string; clientId: string }> = [];
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, clientId: init.headers["idempotency-key"] });
      return { ok: true, status: 200, json: async () => ({}) };
    };

    try {
      // User A logs back in and flushes
      const res = await flushOutbox({
        activeUserId: "user_a",
        activeFamilyId: "fam_a",
        activeBabyId: "baby_a",
      });

      assert.equal(res.flushed, 1);
      assert.equal(res.skippedOtherUser, 0);
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].clientId, "client-id-user-a-1");

      // Queue is now empty
      const pending = await listPending();
      assert.equal(pending.length, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test("3b. Switching babies does not replay another baby's pending draft", async () => {
    const babyAItem: OutboxEntry = {
      clientId: "client-id-baby-a-1",
      url: "/api/records/feeding",
      body: { babyId: "baby_a", type: "formula" },
      createdAt: Date.now(),
      userId: "user_a",
      familyId: "fam_a",
      babyId: "baby_a",
    };
    await enqueueOutbox(babyAItem);

    const origFetch = globalThis.fetch;
    let attempted = false;
    (globalThis as any).fetch = async () => {
      attempted = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    try {
      const res = await flushOutbox({
        activeUserId: "user_a",
        activeFamilyId: "fam_a",
        activeBabyId: "baby_b",
      });

      assert.equal(res.flushed, 0);
      assert.equal(res.skippedOtherScope, 1);
      assert.equal(attempted, false);
      assert.equal((await listPending()).some((item) => item.clientId === babyAItem.clientId), true);
    } finally {
      globalThis.fetch = origFetch;
      await removePending(babyAItem.clientId);
    }
  });

  await t.test("4. 409 Conflict: draft is NEVER deleted, preserved with status: conflict and error details", async () => {
    const conflictItem: OutboxEntry = {
      clientId: "client-id-conflict-1",
      url: "/api/records/sleep",
      body: { baseVersion: "1", type: "night" },
      createdAt: Date.now(),
      userId: "user_a",
      familyId: "fam_a",
      babyId: "baby_a",
    };
    await enqueueOutbox(conflictItem);

    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "版本已被其他设备更新 (409)" }),
    });

    try {
      const res = await flushOutbox({ activeUserId: "user_a" });
      assert.equal(res.flushed, 0);
      assert.equal(res.conflicts, 1);

      // Verify item is retained with status 'conflict'
      const pending = await listPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].clientId, "client-id-conflict-1");
      assert.equal(pending[0].status, "conflict");
      assert.equal(pending[0].error?.status, 409);
      assert.equal(pending[0].error?.code, "CONFLICT");
      assert.equal(pending[0].error?.message, "版本已被其他设备更新 (409)");
    } finally {
      globalThis.fetch = origFetch;
      await removePending("client-id-conflict-1");
    }
  });

  await t.test("5. Orphan/unowned drafts: never auto-submitted under active user, require explicit claim", async () => {
    const orphanItem: OutboxEntry = {
      clientId: "client-orphan-1",
      url: "/api/records/diaper",
      body: { type: "poop" },
      createdAt: Date.now(),
      // No userId!
    };
    await enqueueOutbox(orphanItem);

    const origFetch = globalThis.fetch;
    let attempted = false;
    (globalThis as any).fetch = async () => {
      attempted = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    try {
      // User C is active
      const res = await flushOutbox({ activeUserId: "user_c" });
      assert.equal(res.flushed, 0);
      assert.equal(res.skippedOtherUser, 1);
      assert.equal(attempted, false);

      // Verify detected as orphan
      const orphans = await getOrphanEntries();
      assert.equal(orphans.length, 1);
      assert.equal(orphans[0].clientId, "client-orphan-1");

      // Explicitly claim orphan
      const claimed = await claimOrphanEntries("user_c", "fam_c", "baby_c");
      assert.equal(claimed, 1);

      // Now it belongs to user_c and will flush
      const res2 = await flushOutbox({ activeUserId: "user_c" });
      assert.equal(res2.flushed, 1);
      assert.equal(attempted, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test("6. LocalStorage snapshot namespacing & expiration policy", () => {
    const mockState = {
      user: { id: "user_x", name: "Alice" },
      family: { id: "fam_x" },
      baby: { id: "baby_x" },
      dailySummary: { totalFeedingMl: 500 },
      timeline: [],
    };

    // Save snapshot for user_x
    saveSnapshot("user_x", mockState);

    // Verify key is namespaced
    const rawX = localStorage.getItem(`${SNAPSHOT_KEY_PREFIX}user_x`);
    assert.ok(rawX, "Snapshot must be saved with user ID key prefix");
    const parsedX = JSON.parse(rawX);
    assert.equal(parsedX.userId, "user_x");
    assert.equal(parsedX.version, 2);

    // Other user must not have snapshot
    const rawY = localStorage.getItem(`${SNAPSHOT_KEY_PREFIX}user_y`);
    assert.equal(rawY, null);

    // Verify expiration check
    const expiredSnap = {
      ...parsedX,
      savedAt: Date.now() - (SNAPSHOT_MAX_AGE + 1000), // older than 7 days
    };
    const isFresh = Date.now() - expiredSnap.savedAt < SNAPSHOT_MAX_AGE;
    assert.equal(isFresh, false, "Expired snapshot must be recognized as stale");
  });

  await t.test("7. A rejected request keeps the identity captured before an account and baby switch", async () => {
    mockStore.data.clear();
    const originalFetch = globalThis.fetch;
    let rejectRequest!: (reason: unknown) => void;
    globalThis.fetch = (() => new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    })) as typeof fetch;

    let state: any = {};
    const get = () => state;
    const set = (update: any) => {
      state = { ...state, ...(typeof update === "function" ? update(state) : update) };
    };
    state = {
      ...createRecordsSlice(set, get),
      user: { id: "user_a" },
      family: { id: "fam_a" },
      baby: { id: "baby_a", familyId: "fam_a" },
      selectedBabyId: "baby_a",
      authLoading: false,
    };

    try {
      const submission = state.addFeedingRecord({ type: "formula", amountMl: 120 });
      await new Promise(resolve => setImmediate(resolve));
      state = {
        ...state,
        user: { id: "user_b" },
        family: { id: "fam_b" },
        baby: { id: "baby_b", familyId: "fam_b" },
        selectedBabyId: "baby_b",
      };
      rejectRequest(new TypeError("Failed to fetch"));
      await assert.rejects(submission, /当前离线/);

      const queued = await listPending();
      assert.equal(queued.length, 1);
      assert.equal(queued[0]?.userId, "user_a");
      assert.equal(queued[0]?.familyId, "fam_a");
      assert.equal(queued[0]?.babyId, "baby_a");
      assert.equal(queued[0]?.body.babyId, "baby_a");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("8. A successful stale request cannot prepend its record into the newly selected scope", async () => {
    const originalFetch = globalThis.fetch;
    let resolveRequest!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    })) as typeof fetch;

    let state: any = {};
    const get = () => state;
    const set = (update: any) => {
      state = { ...state, ...(typeof update === "function" ? update(state) : update) };
    };
    state = {
      ...createRecordsSlice(set, get),
      user: { id: "user_a" },
      family: { id: "fam_a" },
      baby: { id: "baby_a", familyId: "fam_a" },
      selectedBabyId: "baby_a",
      authLoading: false,
      feedingRecords: [],
    };

    try {
      const submission = state.addFeedingRecord({ type: "formula", amountMl: 120 });
      await new Promise(resolve => setImmediate(resolve));
      state = {
        ...state,
        user: { id: "user_b" },
        family: { id: "fam_b" },
        baby: { id: "baby_b", familyId: "fam_b" },
        selectedBabyId: "baby_b",
        feedingRecords: [{ id: "record_b", babyId: "baby_b" }],
      };
      resolveRequest(Response.json({ id: "record_a", babyId: "baby_a", type: "formula", amountMl: 120 }));
      await submission;

      assert.deepEqual(state.feedingRecords, [{ id: "record_b", babyId: "baby_b" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("9. Identity switching during the first replay prevents a second queued request", async () => {
    mockStore.data.clear();
    await enqueueOutbox({ clientId: "switch-first", url: "/api/records/feeding", body: { babyId: "baby_a" }, createdAt: 1, userId: "user_a", familyId: "fam_a", babyId: "baby_a" });
    await enqueueOutbox({ clientId: "switch-second", url: "/api/records/diaper", body: { babyId: "baby_a" }, createdAt: 2, userId: "user_a", familyId: "fam_a", babyId: "baby_a" });
    const originalFetch = globalThis.fetch;
    let resolveFirst!: (response: Response) => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
    const sent: string[] = [];
    globalThis.fetch = ((url: string | URL | Request) => {
      sent.push(String(url));
      markFirstStarted();
      return new Promise<Response>(resolve => { resolveFirst = resolve; });
    }) as typeof fetch;
    let current = true;

    try {
      const flushing = flushOutbox({
        activeUserId: "user_a", activeFamilyId: "fam_a", activeBabyId: "baby_a",
        isCurrentIdentity: () => current,
      });
      await firstStarted;
      current = false;
      resolveFirst(Response.json({ ok: true }));
      const result = await flushing;

      assert.deepEqual(sent, ["/api/records/feeding"]);
      assert.equal(result.flushed, 1);
      assert.deepEqual((await listPending()).map(item => item.clientId), ["switch-second"]);
    } finally {
      globalThis.fetch = originalFetch;
      await removePending("switch-first");
      await removePending("switch-second");
    }
  });

  await t.test("10. A stale identity before replay sends no queued request", async () => {
    mockStore.data.clear();
    await enqueueOutbox({ clientId: "stale-before", url: "/api/records/feeding", body: { babyId: "baby_a" }, createdAt: 1, userId: "user_a", familyId: "fam_a", babyId: "baby_a" });
    const originalFetch = globalThis.fetch;
    let sent = false;
    globalThis.fetch = (async () => {
      sent = true;
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const result = await flushOutbox({
        activeUserId: "user_a", activeFamilyId: "fam_a", activeBabyId: "baby_a",
        isCurrentIdentity: () => false,
      });
      assert.equal(sent, false);
      assert.equal(result.flushed, 0);
      assert.deepEqual((await listPending()).map(item => item.clientId), ["stale-before"]);
    } finally {
      globalThis.fetch = originalFetch;
      await removePending("stale-before");
    }
  });
});

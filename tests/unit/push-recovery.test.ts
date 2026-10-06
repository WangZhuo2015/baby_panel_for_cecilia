import test from "node:test";
import assert from "node:assert/strict";
import {
  isPassivePushRecoveryEligible,
  recoverExistingPushSubscription,
} from "../../lib/push-client";

const key = Uint8Array.from([4, ...Array(64).fill(7)]);
const otherKey = Uint8Array.from([4, ...Array(64).fill(8)]);
const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(subscriptionKey: Uint8Array | null = key) {
  const calls: { path: string; body?: unknown }[] = [];
  const counters = { registration: 0, getSubscription: 0, subscribe: 0, unsubscribe: 0 };
  const state = {
    authorizedUsers: ["test_user"] as (string | null)[],
    keyResponse: () => Response.json({ publicKey: encoded(key) }),
    bindingResponse: () => Response.json({ success: true }),
    current: true,
    subscription: null as PushSubscription | null,
  };
  const currentSubscription: PushSubscription = {
    endpoint: "https://push.example.invalid/test_existing",
    expirationTime: null,
    options: { applicationServerKey: subscriptionKey?.slice().buffer as ArrayBuffer | null, userVisibleOnly: true },
    getKey: () => null,
    toJSON: () => ({
      endpoint: "https://push.example.invalid/test_existing",
      expirationTime: null,
      keys: { p256dh: "test_push_p256dh", auth: "test_push_auth" },
    }),
    unsubscribe: async () => {
      counters.unsubscribe++;
      return true;
    },
  };
  state.subscription = currentSubscription;
  const registration = {
    pushManager: {
      getSubscription: async () => {
        counters.getSubscription++;
        return state.subscription;
      },
      subscribe: async () => {
        counters.subscribe++;
        return currentSubscription;
      },
    },
  } as unknown as Pick<ServiceWorkerRegistration, "pushManager">;
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(typeof input, "string");
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path === "/api/auth/me") {
      const userId = state.authorizedUsers.length > 1 ? state.authorizedUsers.shift() : state.authorizedUsers[0];
      return Response.json({ user: userId ? { id: userId } : null }, { headers: { "cache-control": "no-store" } });
    }
    if (path === "/api/push/vapid-key") return state.keyResponse();
    if (path === "/api/push/subscribe") return state.bindingResponse();
    assert.fail("unexpected request " + path);
  };
  const options = (extra: Partial<Parameters<typeof recoverExistingPushSubscription>[0]> = {}) => ({
    permission: "granted",
    pushSupported: true,
    standaloneEligible: true,
    expectedUserId: "test_user",
    isCurrent: () => state.current,
    getRegistration: async () => {
      counters.registration++;
      return registration;
    },
    fetcher,
    timeoutMs: 120,
    ...extra,
  });
  return { calls, counters, state, currentSubscription, registration, fetcher, options };
}

test("passive recovery is gated by an existing granted permission and supported standalone mode", () => {
  assert.equal(isPassivePushRecoveryEligible("granted", true, true), true);
  assert.equal(isPassivePushRecoveryEligible("default", true, true), false);
  assert.equal(isPassivePushRecoveryEligible("denied", true, true), false);
  assert.equal(isPassivePushRecoveryEligible("granted", false, true), false);
  assert.equal(isPassivePushRecoveryEligible("granted", true, false), false);
});

test("no permission or no authorized session never reads, creates, or removes a subscription", async () => {
  const denied = fixture();
  assert.equal(await recoverExistingPushSubscription(denied.options({ permission: "default" })), "skipped");
  assert.deepEqual(denied.calls, []);
  assert.deepEqual(denied.counters, { registration: 0, getSubscription: 0, subscribe: 0, unsubscribe: 0 });

  const anonymous = fixture();
  anonymous.state.authorizedUsers = [null];
  assert.equal(await recoverExistingPushSubscription(anonymous.options()), "skipped");
  assert.deepEqual(anonymous.calls.map(call => call.path), ["/api/auth/me"]);
  assert.deepEqual(anonymous.counters, { registration: 0, getSubscription: 0, subscribe: 0, unsubscribe: 0 });

  const identityNotReady = fixture();
  assert.equal(await recoverExistingPushSubscription(identityNotReady.options({ expectedUserId: "" })), "skipped");
  assert.deepEqual(identityNotReady.calls, []);
  assert.deepEqual(identityNotReady.counters, { registration: 0, getSubscription: 0, subscribe: 0, unsubscribe: 0 });

  const missing = fixture();
  missing.state.subscription = null;
  assert.equal(await recoverExistingPushSubscription(missing.options()), "skipped");
  assert.deepEqual(missing.calls.map(call => call.path), ["/api/auth/me"]);
  assert.deepEqual(missing.counters, { registration: 1, getSubscription: 1, subscribe: 0, unsubscribe: 0 });

  const staleStore = fixture();
  assert.equal(await recoverExistingPushSubscription(staleStore.options({ expectedUserId: "test_other_user" })), "skipped");
  assert.deepEqual(staleStore.calls.map(call => call.path), ["/api/auth/me"]);
  assert.deepEqual(staleStore.counters, { registration: 0, getSubscription: 0, subscribe: 0, unsubscribe: 0 });
});

test("same-key recovery uploads the complete existing subscription under the current session", async () => {
  const f = fixture();
  assert.equal(await recoverExistingPushSubscription(f.options()), "synced");
  assert.deepEqual(f.calls.map(call => call.path), [
    "/api/auth/me", "/api/push/vapid-key", "/api/auth/me", "/api/push/subscribe",
  ]);
  assert.deepEqual(f.calls.at(-1)?.body, f.currentSubscription.toJSON());
  assert.equal(Object.hasOwn(f.calls.at(-1)?.body as object, "userId"), false);
  assert.deepEqual(f.counters, { registration: 1, getSubscription: 1, subscribe: 0, unsubscribe: 0 });
});

test("key mismatch or an unexposed key leaves the browser subscription untouched", async () => {
  for (const subscriptionKey of [otherKey, null]) {
    const f = fixture(subscriptionKey);
    assert.equal(await recoverExistingPushSubscription(f.options()), "skipped");
    assert.equal(f.calls.some(call => call.path === "/api/push/subscribe"), false);
    assert.deepEqual(f.counters, { registration: 1, getSubscription: 1, subscribe: 0, unsubscribe: 0 });
  }
});

test("a session or user change during service-worker/subscription waits prevents any upload", async () => {
  const f = fixture();
  const pending = deferred<PushSubscription | null>();
  const started = deferred<void>();
  f.registration.pushManager.getSubscription = () => {
    started.resolve(undefined);
    return pending.promise;
  };
  const recovery = recoverExistingPushSubscription(f.options());
  await started.promise;
  f.state.current = false;
  pending.resolve(f.currentSubscription);
  assert.equal(await recovery, "skipped");
  assert.deepEqual(f.calls.map(call => call.path), ["/api/auth/me"]);
  assert.equal(f.calls.some(call => call.path === "/api/push/subscribe"), false);
});

test("a different server session discovered before upload cannot receive the old tab subscription", async () => {
  const f = fixture();
  f.state.authorizedUsers = ["test_user", "test_other_user"];
  assert.equal(await recoverExistingPushSubscription(f.options()), "skipped");
  assert.equal(f.calls.some(call => call.path === "/api/push/subscribe"), false);
  assert.deepEqual(f.counters, { registration: 1, getSubscription: 1, subscribe: 0, unsubscribe: 0 });
});

test("a bounded browser wait can fail and a later attempt can recover", async () => {
  const f = fixture();
  let stall = true;
  const options = () => ({
    ...f.options(),
    timeoutMs: 20,
    getRegistration: () => {
      f.counters.registration++;
      return stall
        ? new Promise<Pick<ServiceWorkerRegistration, "pushManager">>(() => {})
        : Promise.resolve(f.registration);
    },
  });
  await assert.rejects(() => recoverExistingPushSubscription(options()), /推送服务启动超时/);
  stall = false;
  assert.equal(await recoverExistingPushSubscription(options()), "synced");
  assert.equal(f.calls.filter(call => call.path === "/api/push/subscribe").length, 1);
});

test("repeated tab recoveries send the same endpoint and full keys for an idempotent server upsert", async () => {
  const f = fixture();
  const persistedByEndpoint = new Map<string, unknown>();
  f.state.bindingResponse = () => {
    const subscriptionCall = [...f.calls].reverse().find(call => call.path === "/api/push/subscribe");
    const body = subscriptionCall?.body as { endpoint?: string } | undefined;
    if (body?.endpoint) persistedByEndpoint.set(body.endpoint, subscriptionCall?.body);
    return Response.json({ success: true });
  };
  const [first, second] = await Promise.all([
    recoverExistingPushSubscription(f.options()),
    recoverExistingPushSubscription(f.options()),
  ]);
  assert.deepEqual([first, second], ["synced", "synced"]);
  assert.equal(persistedByEndpoint.size, 1);
  assert.equal(f.calls.filter(call => call.path === "/api/push/subscribe").length, 2);
  assert.deepEqual(persistedByEndpoint.get("https://push.example.invalid/test_existing"), f.currentSubscription.toJSON());
});

test("a failed server acknowledgement does not stick and can be retried", async () => {
  const f = fixture();
  f.state.bindingResponse = () => Response.json({ error: "test_push_recovery_outage" }, { status: 503 });
  await assert.rejects(() => recoverExistingPushSubscription(f.options()), /test_push_recovery_outage/);
  f.state.bindingResponse = () => Response.json({ success: true });
  assert.equal(await recoverExistingPushSubscription(f.options()), "synced");
  assert.equal(f.calls.filter(call => call.path === "/api/push/subscribe").length, 2);
});

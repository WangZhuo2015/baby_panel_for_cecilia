import test from "node:test";
import assert from "node:assert/strict";
import { getPushRegistration, PushClientError, pushErrorMessage, sendTestPush, syncPushSubscription } from "../../lib/push-client";

// Browser and HTTP ports are synthetic. These tests exercise the actual client
// control flow and response handling, not permission, tenancy, or delivery.
const key = Uint8Array.from([4, ...Array(64).fill(7)]);
const otherKey = Uint8Array.from([4, ...Array(64).fill(8)]);
const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function fixture(initial: "current" | "old" | "missing" | "unknown" = "current") {
  const calls: { path: string; body?: unknown }[] = [];
  const counters = { subscribe: 0, unsubscribe: 0 };
  const state = {
    keyResponse: Response.json({ publicKey: encoded(key) }),
    binding: () => Response.json({ success: true }),
    test: () => Response.json({ success: true, sent: 1, simulated: false }),
    removeResult: true,
    removeError: null as Error | null,
  };
  const makeSubscription = (bytes: Uint8Array | null, endpoint: string): PushSubscription => ({
    endpoint,
    expirationTime: null,
    options: { applicationServerKey: bytes ? bytes.slice().buffer : null, userVisibleOnly: true },
    getKey: () => null,
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "test_push_key", auth: "test_push_auth" } }),
    unsubscribe: async () => {
      counters.unsubscribe++;
      if (state.removeError) throw state.removeError;
      if (state.removeResult) current = null;
      return state.removeResult;
    },
  });
  let current = initial === "missing" ? null : makeSubscription(initial === "unknown" ? null : initial === "old" ? otherKey : key, "https://push.example.invalid/test_existing");
  const registration: Pick<ServiceWorkerRegistration, "pushManager"> = {
    pushManager: {
      getSubscription: async () => current,
      permissionState: async () => "granted",
      subscribe: async options => {
        counters.subscribe++;
        assert.equal(options?.userVisibleOnly, true);
        const buffer = options?.applicationServerKey;
        assert.ok(buffer instanceof Uint8Array);
        assert.deepEqual(buffer, key);
        current = makeSubscription(key, "https://push.example.invalid/test_new");
        return current;
      },
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    assert.ok(typeof input === "string" && input.startsWith("/api/push/"));
    calls.push({ path: input, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (input === "/api/push/vapid-key") return state.keyResponse.clone();
    if (input === "/api/push/subscribe") return state.binding();
    if (input === "/api/push/test") return state.test();
    assert.fail("unexpected client request");
  };
  return { registration, fetcher, counters, calls, state, subscription: () => current };
}

test("same VAPID key reuses and uploads the complete existing subscription", async () => {
  const f = fixture();
  const previous = f.subscription();
  assert.equal(await syncPushSubscription(f.registration, true, f.fetcher), previous);
  assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
  assert.deepEqual(f.calls.map(call => call.path), ["/api/push/vapid-key", "/api/push/subscribe"]);
  assert.deepEqual(f.calls[1].body, previous?.toJSON());
});

test("confirmed VAPID drift rotates once, while unavailable keys preserve the local subscription", async () => {
  const changed = fixture("old");
  assert.equal((await syncPushSubscription(changed.registration, true, changed.fetcher))?.endpoint, "https://push.example.invalid/test_new");
  assert.deepEqual(changed.counters, { subscribe: 1, unsubscribe: 1 });
  for (const keyResponse of [Response.json({ error: "test_key_outage" }, { status: 503 }), Response.json({ publicKey: "bad" })]) {
    const f = fixture("old");
    const previous = f.subscription();
    f.state.keyResponse = keyResponse;
    await assert.rejects(() => syncPushSubscription(f.registration, true, f.fetcher));
    assert.equal(f.subscription(), previous);
    assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
  }
});

test("a browser without an exposed VAPID key preserves its subscription", async () => {
  const f = fixture("unknown");
  const previous = f.subscription();
  assert.equal(await syncPushSubscription(f.registration, true, f.fetcher), previous);
  assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
});

test("auto-check does not create a missing subscription; manual binding does", async () => {
  const f = fixture("missing");
  assert.equal(await syncPushSubscription(f.registration, false, f.fetcher), null);
  assert.equal(f.calls.length, 0);
  const created = await syncPushSubscription(f.registration, true, f.fetcher);
  assert.ok(created);
  assert.deepEqual(f.counters, { subscribe: 1, unsubscribe: 0 });
});

test("failed removal stops a key rotation before creating or uploading a replacement", async () => {
  const f = fixture("old");
  f.state.removeResult = false;
  await assert.rejects(() => syncPushSubscription(f.registration, true, f.fetcher), /更新推送订阅失败/);
  assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 1 });
  assert.equal(f.calls.length, 1);
});

test("binding requires success true and propagates server or malformed-response failures", async () => {
  for (const response of [
    Response.json({ success: false }), Response.json({}), new Response("not-json"),
    Response.json({ error: "test_sync_outage" }, { status: 503 }),
    Response.json({ error: { message: "test_nested_denial" } }, { status: 403 }),
  ]) {
    const f = fixture();
    f.state.binding = () => response.clone();
    await assert.rejects(() => syncPushSubscription(f.registration, true, f.fetcher));
    assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
  }
  const f = fixture();
  f.state.binding = () => Response.json({ error: "test_sync_outage" }, { status: 503 });
  await assert.rejects(() => syncPushSubscription(f.registration, true, f.fetcher), /test_sync_outage/);
});

test("test notification rejects simulation and absent, zero, invalid, or unconfirmed sent counts", async () => {
  for (const body of [
    {}, { success: true }, { success: true, sent: 0 }, { success: true, sent: "1" },
    { success: true, sent: -1 }, { success: true, sent: 1.5 },
    { success: false, sent: 1 }, { success: true, sent: 1, simulated: true },
  ]) {
    const f = fixture();
    f.state.test = () => Response.json(body);
    await assert.rejects(() => sendTestPush(f.subscription()!, f.fetcher));
    assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
  }
});

test("a positive non-simulated accepted count returns successfully with this device payload", async () => {
  const f = fixture();
  await sendTestPush(f.subscription()!, f.fetcher);
  assert.deepEqual(f.calls[0], { path: "/api/push/test", body: { subscription: f.subscription()?.toJSON() } });
});

test("provider-confirmed expired subscription is removed and a manual retry creates a new endpoint", async () => {
  const f = fixture();
  f.state.test = () => Response.json({ error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" }, { status: 400 });
  await assert.rejects(() => sendTestPush(f.subscription()!, f.fetcher), error => error instanceof PushClientError && error.code === "PUSH_SUBSCRIPTION_GONE");
  assert.equal(f.subscription(), null);
  assert.equal((await syncPushSubscription(f.registration, true, f.fetcher))?.endpoint, "https://push.example.invalid/test_new");
  assert.deepEqual(f.counters, { subscribe: 1, unsubscribe: 1 });
});

test("ordinary transport failures do not remove an otherwise valid subscription", async () => {
  const f = fixture();
  f.state.test = () => Response.json({ error: "test_gateway_outage" }, { status: 503 });
  await assert.rejects(() => sendTestPush(f.subscription()!, f.fetcher), /test_gateway_outage/);
  assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 0 });
});

test("expired cleanup false or rejection retains the gone code and actionable recovery message", async () => {
  for (const rejects of [false, true]) {
    const f = fixture();
    f.state.test = () => Response.json({ error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" }, { status: 400 });
    f.state.removeResult = false;
    if (rejects) f.state.removeError = new Error("test_browser_removal_failure");
    await assert.rejects(() => sendTestPush(f.subscription()!, f.fetcher), error => {
      assert.ok(error instanceof PushClientError);
      assert.equal(error.code, "PUSH_SUBSCRIPTION_GONE");
      assert.match(error.message, /重置本站通知权限/);
      return true;
    });
    assert.ok(f.subscription());
    assert.deepEqual(f.counters, { subscribe: 0, unsubscribe: 1 });
  }
});

function workers(registration?: ServiceWorkerRegistration): Pick<ServiceWorkerContainer, "getRegistration" | "register" | "ready"> {
  return {
    getRegistration: async () => registration,
    register: async () => ({ active: null }) as ServiceWorkerRegistration,
    ready: new Promise(() => {}),
  };
}

test("without registration, passive inspection fails immediately instead of waiting on ready", async () => {
  await assert.rejects(() => getPushRegistration(workers(), false, 20), /尚未注册推送服务/);
});

test("new inactive registration has a bounded activation wait; active registration bypasses ready", async () => {
  await assert.rejects(() => getPushRegistration(workers(), true, 20), /推送服务启动超时/);
  const active = { active: { state: "activated" } } as ServiceWorkerRegistration;
  assert.equal(await getPushRegistration(workers(active), false, 20), active);
});

test("permission and request timeouts have actionable visible messages", () => {
  assert.match(pushErrorMessage(new DOMException("test", "NotAllowedError")), /浏览器设置/);
  assert.match(pushErrorMessage(new DOMException("test", "TimeoutError")), /检查网络后重试/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function watchdog<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("test watchdog: native operation did not time out")), 180);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test("stalled getSubscription times out; a late result never starts an upload", async () => {
  const f = fixture();
  const pending = deferred<PushSubscription | null>();
  f.registration.pushManager.getSubscription = () => pending.promise;
  await assert.rejects(() => watchdog(syncPushSubscription(f.registration, true, f.fetcher, 20)), /读取推送订阅超时/);
  pending.resolve(f.subscription());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 0);
});

test("stalled subscribe times out; a late subscription never gets bound", async () => {
  const f = fixture("missing");
  const pending = deferred<PushSubscription>();
  f.registration.pushManager.subscribe = () => pending.promise;
  await assert.rejects(() => watchdog(syncPushSubscription(f.registration, true, f.fetcher, 20)), /创建推送订阅超时/);
  pending.resolve(fixture().subscription()!);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(call => call.path), ["/api/push/vapid-key"]);
});

test("stalled key-rotation unsubscribe times out; a late removal never creates or uploads", async () => {
  const f = fixture("old");
  const pending = deferred<boolean>();
  f.subscription()!.unsubscribe = () => pending.promise;
  await assert.rejects(() => watchdog(syncPushSubscription(f.registration, true, f.fetcher, 20)), /更新推送订阅超时/);
  pending.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counters.subscribe, 0);
  assert.deepEqual(f.calls.map(call => call.path), ["/api/push/vapid-key"]);
});

test("stalled expired cleanup times out with the gone code and browser recovery instructions", async () => {
  const f = fixture();
  const pending = deferred<boolean>();
  f.subscription()!.unsubscribe = () => pending.promise;
  f.state.test = () => Response.json({ error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" }, { status: 400 });
  await assert.rejects(() => watchdog(sendTestPush(f.subscription()!, f.fetcher, 20)), error => {
    assert.ok(error instanceof PushClientError);
    assert.equal(error.code, "PUSH_SUBSCRIPTION_GONE");
    assert.match(error.message, /重置本站通知权限/);
    return true;
  });
  pending.resolve(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counters.subscribe, 0);
  assert.deepEqual(f.calls.map(call => call.path), ["/api/push/test"]);
});

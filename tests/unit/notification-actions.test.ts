import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import {
  acknowledgeNotifications, isNotificationRead, parseNotificationItems,
  type NotificationIdentity, type ReadableNotification,
} from "../../lib/notification-actions";

const identity: NotificationIdentity = { userId: "test_user", familyId: "test_family", babyId: "test_baby" };
const server = (id = "test_notification"): ReadableNotification => ({ id, serverNotificationId: id, readAt: null });
const fetcher = (fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch => fn as typeof fetch;

test("persisted readAt, not stale local IDs, controls server-backed unread state", () => {
  assert.equal(isNotificationRead(server(), new Set(["test_notification"])), false);
  assert.equal(isNotificationRead({ ...server(), readAt: "2026-09-24T00:00:00.000Z" }, new Set()), true);
  assert.equal(isNotificationRead({ ...server(), readAt: "invalid" }, new Set()), false);
  assert.equal(isNotificationRead({ id: "daily-feeding" }, new Set(["daily-feeding"])), true);
});

test("notification lists reject duplicates and incomplete persisted state", () => {
  const item = { ...server(), type: "daily", title: "test_notice", detail: "", time: "刚刚", urgent: false, icon: "" };
  assert.equal(parseNotificationItems([item])[0]?.readAt, null);
  for (const invalid of [[item, item], [{ ...item, serverNotificationId: "test_other" }],
    [{ ...item, readAt: undefined }], [{ ...item, readAt: "invalid" }], [{ ...item, createdAt: NaN }], {}]) {
    assert.throws(() => parseNotificationItems(invalid));
  }
});

test("derived/read notifications require no server write and repeated IDs deduplicate", async () => {
  const done = { ...server(), readAt: "2026-09-24T00:00:00.000Z" };
  const result = await acknowledgeNotifications([{ id: "daily-feeding" }, done, done], identity, () => identity,
    fetcher(async () => { throw new Error("Unexpected network request"); }));
  assert.deepEqual(new Set(result.acknowledged), new Set(["daily-feeding", done.id]));
  assert.deepEqual(result.failed, []);
});

for (const status of [401, 403, 409, 429, 503]) {
  test(`server ${status} never becomes a successful read acknowledgement`, async () => {
    const result = await acknowledgeNotifications([server()], identity, () => identity,
      fetcher(async () => Response.json({ success: false }, { status })));
    assert.deepEqual(result.acknowledged, []);
    assert.deepEqual(result.failed, ["test_notification"]);
  });
}

test("HTTP success without explicit positive acknowledgement is rejected", async () => {
  for (const data of [{}, { success: false }, { success: "true" }, null]) {
    const result = await acknowledgeNotifications([server()], identity, () => identity,
      fetcher(async () => Response.json(data)));
    assert.deepEqual(result.acknowledged, []);
    assert.equal(result.failed.length, 1);
  }
});

test("only four acknowledgements run concurrently and queue snapshots cannot be retargeted", { timeout: 5000 }, async () => {
  const items = Array.from({ length: 12 }, (_, i) => server(`test_n_${i}`));
  const captured = { ...identity };
  const paths: string[] = [];
  const releases: (() => void)[] = [];
  let active = 0;
  let maximum = 0;
  const pending = acknowledgeNotifications(items, captured, () => identity, fetcher(async (input, init) => {
    paths.push(String(input));
    assert.equal(new Headers(init?.headers).get("x-growdesk-expected-user"), identity.userId);
    maximum = Math.max(maximum, ++active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--;
    return Response.json({ success: true });
  }));
  await tick();
  assert.equal(paths.length, 4);
  captured.userId = "test_changed_user";
  items[5]!.serverNotificationId = "test_retargeted";
  while (paths.length < 12 || active > 0) {
    releases.splice(0).forEach(release => release());
    await tick();
  }
  const result = await pending;
  assert.equal(maximum, 4);
  assert.equal(result.acknowledged.length, 12);
  assert.equal(result.failed.length, 0);
  assert.ok(paths.every(path => !path.includes("retargeted")));
});

test("identity change stops queued reads and ignores already completed responses", async () => {
  let current: NotificationIdentity | null = identity;
  const releases: (() => void)[] = [];
  let calls = 0;
  const pending = acknowledgeNotifications(Array.from({ length: 10 }, (_, i) => server(`test_n_${i}`)), identity, () => current,
    fetcher(async () => {
      calls++;
      await new Promise<void>(resolve => releases.push(resolve));
      return Response.json({ success: true });
    }));
  await tick();
  current = { ...identity, babyId: "test_other_baby" };
  releases.forEach(release => release());
  const result = await pending;
  assert.equal(calls, 4);
  assert.equal(result.stale, true);
  assert.deepEqual(result.acknowledged, []);
});

test("abort invalidates an A-to-B-to-A request even when the final IDs match", async () => {
  const controller = new AbortController();
  const pending = acknowledgeNotifications([server()], identity, () => identity,
    fetcher(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("test_aborted")), { once: true });
    })), controller.signal);
  controller.abort();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.deepEqual(result.acknowledged, []);
});

test("authorization denial stops scheduling new reads without silently dropping failed IDs", async () => {
  let calls = 0;
  const result = await acknowledgeNotifications(Array.from({ length: 12 }, (_, i) => server(`test_n_${i}`)), identity, () => identity,
    fetcher(async () => { calls++; return Response.json({ success: false }, { status: 403 }); }));
  assert.ok(calls <= 4);
  assert.equal(new Set(result.failed).size, 12);
  assert.deepEqual(result.acknowledged, []);
});

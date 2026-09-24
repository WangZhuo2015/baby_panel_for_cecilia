import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeError,
  type BridgeFetch,
  type BridgeResult,
} from "../../lib/growdesk/bridge-protocol";
import {
  acknowledgeGrowDeskVoiceLog,
  createGrowDeskVoiceLog,
  getGrowDeskVoiceLog,
  listGrowDeskVoiceLogs,
} from "../../lib/growdesk/voice-log-api";

type BridgeOptions = Parameters<BridgeFetch>[1];

function voiceLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "test_voice_log_1",
    userId: "test_user_voice_logs",
    familyId: "test_family_voice_logs",
    babyId: "test_baby_voice_logs",
    prompt: "test prompt",
    reply: "test reply",
    isAsync: false,
    isFastPath: true,
    acknowledged: true,
    createdAt: "2026-09-19T00:00:00.000Z",
    baby: {
      id: "test_baby_voice_logs",
      nickname: "test baby",
      gender: "unknown",
    },
    ...overrides,
  };
}

function ok<T>(data: T): BridgeResult<T> {
  return { ok: true, status: 200, data };
}

function fakeApi(
  handler: (path: string, options: BridgeOptions | undefined) => BridgeResult<unknown> | Promise<BridgeResult<unknown>>,
): BridgeFetch {
  return (async <T>(path: string, options?: BridgeOptions) =>
    await handler(path, options) as BridgeResult<T>) as BridgeFetch;
}

test("voice log create maps the canonical response and preserves the write contract", async () => {
  const calls: Array<{ path: string; options: BridgeOptions | undefined }> = [];
  const api = fakeApi((path, options) => {
    calls.push({ path, options });
    return ok(voiceLog());
  });

  const result = await createGrowDeskVoiceLog(api, "test_access_token", {
    babyId: "test_baby_voice_logs",
    prompt: "test prompt",
    reply: "test reply",
    isAsync: false,
    isFastPath: true,
    acknowledged: true,
  });

  assert.deepEqual(result, {
    id: "test_voice_log_1",
    userId: "test_user_voice_logs",
    babyId: "test_baby_voice_logs",
    prompt: "test prompt",
    reply: "test reply",
    isAsync: false,
    isFastPath: true,
    acknowledged: true,
    createdAt: "2026-09-19T00:00:00.000Z",
    baby: { id: "test_baby_voice_logs", nickname: "test baby", gender: "unknown" },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/v1/voice/logs");
  assert.equal(calls[0]!.options?.method, "POST");
  assert.equal(calls[0]!.options?.accessToken, "test_access_token");
  assert.deepEqual(calls[0]!.options?.body, {
    babyId: "test_baby_voice_logs",
    prompt: "test prompt",
    reply: "test reply",
    isAsync: false,
    isFastPath: true,
    acknowledged: true,
  });
});

test("voice log list preserves old list and unread projections", async () => {
  const paths: string[] = [];
  const api = fakeApi((path) => {
    paths.push(path);
    if (path.includes("unreadAsync=true")) return ok(voiceLog({ isAsync: true, acknowledged: false }));
    return ok([voiceLog(), voiceLog({ id: "test_voice_log_2", isFastPath: false })]);
  });

  const list = await listGrowDeskVoiceLogs(api, "test_access_token", { limit: 200 });
  assert.equal(paths[0], "/api/v1/voice/logs?limit=50");
  assert.equal(list.logs.length, 2);
  assert.equal(list.unreadLog, null);
  assert.equal(list.logs[1]!.id, "test_voice_log_2");

  const unread = await listGrowDeskVoiceLogs(api, "test_access_token", { unreadAsyncOnly: true });
  assert.equal(paths[1], "/api/v1/voice/logs?unreadAsync=true");
  assert.equal(unread.logs.length, 0);
  assert.equal(unread.unreadLog?.acknowledged, false);

  const emptyApi = fakeApi(() => ok(null));
  const empty = await listGrowDeskVoiceLogs(emptyApi, "test_access_token", { unreadAsyncOnly: true });
  assert.equal(empty.unreadLog, null);
});

test("voice log detail and acknowledgement use the canonical id routes", async () => {
  const calls: Array<{ path: string; options: BridgeOptions | undefined }> = [];
  const api = fakeApi((path, options) => {
    calls.push({ path, options });
    return options?.method === "PATCH" ? ok({ success: true as const }) : ok(voiceLog());
  });

  const detail = await getGrowDeskVoiceLog(api, "test_access_token", "test_voice_log_1");
  await acknowledgeGrowDeskVoiceLog(api, "test_access_token", "test_voice_log_1", false);

  assert.equal(detail.id, "test_voice_log_1");
  assert.equal(calls[0]!.path, "/api/v1/voice/logs/test_voice_log_1");
  assert.equal(calls[0]!.options?.accessToken, "test_access_token");
  assert.equal(calls[1]!.path, "/api/v1/voice/logs/test_voice_log_1");
  assert.equal(calls[1]!.options?.method, "PATCH");
  assert.deepEqual(calls[1]!.options?.body, { acknowledged: false });
});

test("voice log bridge rejects malformed canonical data and propagates upstream status", async () => {
  await assert.rejects(
    () => getGrowDeskVoiceLog(fakeApi(() => ok({ ...voiceLog(), familyId: undefined })), "test_access_token", "test_voice_log_1"),
    (error: unknown) => error instanceof BridgeError && error.status === 502 && error.code === "UPSTREAM_INVALID_RESPONSE",
  );
  await assert.rejects(
    () => getGrowDeskVoiceLog(fakeApi(() => ({ ok: false, status: 404, error: { code: "RECORD_NOT_FOUND", message: "test missing" } })), "test_access_token", "test_voice_log_1"),
    (error: unknown) => error instanceof BridgeError && error.status === 404 && error.code === "RECORD_NOT_FOUND",
  );
});

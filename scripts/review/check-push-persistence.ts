import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import webPush from "web-push";

interface Manifest {
  version: number; runId: string; ownerPid: number; apiPid: number; apiUrl: string;
  webPort: number; pgPort: number; database: string; role: string; password: string;
  psql: string; routePath: string; resultPath: string;
}
interface Account { id: string; cookie: string; accessToken: string; }
const manifestPath = process.env.OWNED_PUSH_RUN_MANIFEST;
assert.ok(manifestPath && path.isAbsolute(manifestPath), "Owned run manifest required");
const metadata = await stat(manifestPath);
assert.equal(metadata.mode & 0o077, 0, "Credentials must be owner-only");
const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.version, 1);
assert.match(manifest.runId, /^[a-z0-9_]+$/);
assert.equal(manifest.database, "test_growdesk_" + manifest.runId);
assert.equal(manifest.role, "test_app_" + manifest.runId);
for (const pid of [manifest.ownerPid, manifest.apiPid]) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  process.kill(pid, 0);
}
const apiOrigin = new URL(manifest.apiUrl);
assert.equal(apiOrigin.protocol, "http:");
assert.equal(apiOrigin.hostname, "127.0.0.1");
for (const port of [Number(apiOrigin.port), manifest.pgPort, manifest.webPort]) {
  assert.ok(Number.isSafeInteger(port) && port > 1024 && port <= 65535);
  assert.ok(![5432, 6379, 3088, 3089].includes(port));
}
assert.ok(path.isAbsolute(manifest.psql));
assert.ok(path.isAbsolute(manifest.routePath));
const webRoot = path.resolve(import.meta.dirname, "../..");
assert.ok(manifest.routePath.startsWith(webRoot + path.sep));
assert.ok(manifest.resultPath.startsWith(path.join(webRoot, "evidence/tasks/WEB_PUSH_DELIVERY_20261005") + path.sep));
const webOrigin = `http://127.0.0.1:${manifest.webPort}`;
const originalFetch = globalThis.fetch;
const observed: { method: string; path: string }[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (![apiOrigin.origin, webOrigin].includes(url.origin)) throw new Error("NON_OWNED_NETWORK_REQUEST_REJECTED");
  observed.push({ method: init?.method || "GET", path: url.pathname });
  return originalFetch(input, { ...init, redirect: "error" });
};
const vapid = webPush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
process.env.VAPID_SUBJECT = "mailto:test_push@example.invalid";
const originalSend = webPush.sendNotification;
let gatewayMode: "accepted" | "denied" = "accepted";
let gatewayCalls = 0;
// The only replaced side effect is the external push gateway. Never invoke the original sender.
webPush.sendNotification = async () => {
  gatewayCalls++;
  if (gatewayMode === "denied") throw Object.assign(new Error("test_gateway_denied"), { statusCode: 403 });
  return { statusCode: 201, body: "", headers: {} };
};
const report = {
  passed: false, cases: [] as { name: string; passed: boolean; error?: string }[],
  realAuthentication: false, realPostgreSQL: true,
  bffRuntime: "owned Node HTTP shim invoking the actual route handlers; Next runtime is not exercised",
  mockedSideEffects: ["external WebPush gateway sendNotification only"],
  physicalDeviceDeliveryVerified: false, externalPushRequests: 0,
  observedHttp: observed, gatewayCalls: 0,
  familyRecordNotificationProbe: null as null | {
    recordCommitted: boolean; recipientSubscriptionPresent: boolean;
    notificationDelta: number; pushTaskDelta: number; familyChangeDelta: number;
    missingEventObserved: boolean;
  },
};
function sql(statement: string): string {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  environment.PGPASSWORD = manifest.password;
  environment.PGCONNECT_TIMEOUT = "5";
  return execFileSync(manifest.psql, ["-X", "-v", "ON_ERROR_STOP=1", "-A", "-t",
    "-h", "127.0.0.1", "-p", String(manifest.pgPort), "-U", manifest.role, "-d", manifest.database],
  { input: statement, encoding: "utf8", env: environment, timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
assert.equal(sql("SELECT current_database() || '|' || current_user || '|' || (SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user);"),
  `${manifest.database}|${manifest.role}|false`);
async function api(method: string, pathname: string, body?: unknown, token?: string, key?: string) {
  const response = await fetch(apiOrigin.origin + pathname, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, data: await response.json() };
}
async function account(label: string): Promise<Account> {
  const username = `test_push_${manifest.runId}_${label}`;
  const password = "test_password_" + randomBytes(16).toString("hex");
  const registered = await api("POST", "/api/v1/auth/register", { username, password, displayName: username, deviceLabel: "test_push_persistence" });
  assert.equal(registered.status, 201, "REAL_REGISTRATION_FAILED");
  const secret = randomBytes(32).toString("hex");
  const bound = await api("POST", "/api/v1/auth/bff/session", {
    username, password, sessionSecretHash: createHash("sha256").update(secret).digest("hex"), deviceLabel: "test_push_bff",
  });
  assert.equal(bound.status, 200, "REAL_BFF_SESSION_FAILED");
  assert.equal(bound.data.data.user.id, registered.data.data.user.id, "BFF_PRINCIPAL_MISMATCH");
  const me = await api("GET", "/api/v1/me", undefined, bound.data.data.accessToken);
  assert.equal(me.status, 200, "REAL_ACCESS_TOKEN_REJECTED");
  assert.equal(me.data.data.id, registered.data.data.user.id, "ACCESS_PRINCIPAL_MISMATCH");
  assert.match(me.data.data.id, /^[a-f0-9-]{36}$/, "INVALID_SERVER_USER_ID");
  return { id: me.data.data.id, cookie: `growdesk_web_dev=${secret}`, accessToken: bound.data.data.accessToken };
}
async function check(name: string, run: () => Promise<void> | void) {
  try {
    await run(); report.cases.push({ name, passed: true }); console.log("PASS " + name);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "CHECK_FAILED";
    report.cases.push({ name, passed: false, error: message }); console.log("FAIL " + name);
  }
}
let server: http.Server | undefined;
try {
  const testRoute = await import(pathToFileURL(manifest.routePath).href);
  const subscribeRoute = await import("../../app/api/push/subscribe/route");
  const handlers = new Map<string, (request: Request) => Promise<Response>>([
    ["/api/push/subscribe", subscribeRoute.POST], ["/api/push/test", testRoute.POST],
  ]);
  server = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 16384) throw new Error("REQUEST_TOO_LARGE");
        chunks.push(chunk);
      }
      const pathname = new URL(incoming.url || "/", webOrigin).pathname;
      const handler = handlers.get(pathname);
      if (!handler || incoming.method !== "POST") { outgoing.writeHead(404); outgoing.end(); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(",") : value);
      }
      const response = await handler(new Request(webOrigin + pathname, {
        method: "POST", headers, body: Buffer.concat(chunks),
      }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "TEST_ROUTE_RUNTIME_FAILED" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject); server!.listen(manifest.webPort, "127.0.0.1", resolve);
  });
  const owner = await account("owner");
  const outsider = await account("outsider");
  report.realAuthentication = true;
  report.cases.push({ name: "real registration, session exchange and Bearer principal", passed: true });
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const subscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/test_persistence_${manifest.runId}`,
    expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
  const installation = createHash("sha256").update(subscription.endpoint).digest("hex").slice(0, 32);
  function row() {
    const rows = JSON.parse(sql(`SELECT COALESCE(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM push_devices d WHERE installation_id='${installation}';`));
    assert.equal(rows.length, 1, "DEVICE_ROW_COUNT_CHANGED");
    assert.equal(rows[0].user_id, owner.id, "DEVICE_PRINCIPAL_CHANGED");
    return rows[0] as { token: string; updated_at: string };
  }
  function fullToken() {
    const value = row();
    let parsed;
    try { parsed = JSON.parse(value.token); } catch { throw new Error("PUSH_TEST_DROPPED_ENCRYPTION_KEYS"); }
    assert.deepEqual(parsed, subscription, "PERSISTED_SUBSCRIPTION_CHANGED");
    return value;
  }
  async function web(pathname: string, body: unknown, cookie = owner.cookie, origin = webOrigin) {
    const response = await fetch(webOrigin + pathname, {
      method: "POST", headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, data: await response.json() };
  }
  await check("subscribe persists full encryption keys through real HTTP and PostgreSQL", async () => {
    assert.equal((await web("/api/push/subscribe", subscription)).status, 200, "SUBSCRIPTION_FAILED");
    fullToken();
  });
  await check("test push preserves the complete subscription and authenticated owner", async () => {
    const response = await web("/api/push/test", { subscription, userId: outsider.id });
    assert.equal(response.status, 200, "TEST_PUSH_REJECTED");
    assert.equal(response.data.sent, 1, "TEST_PUSH_NOT_ACKNOWLEDGED");
    assert.equal(response.data.simulated, undefined, "SIMULATED_SUCCESS_RETURNED");
    fullToken();
    assert.equal(sql(`SELECT count(*) FROM push_devices WHERE user_id='${outsider.id}';`), "0", "UNTRUSTED_USER_ID_PERSISTED");
  });
  await check("anonymous and unknown real sessions cannot overwrite device registration", async () => {
    const before = row(); const calls = gatewayCalls;
    for (const cookie of ["", "growdesk_web_dev=" + "f".repeat(64)]) {
      assert.equal((await web("/api/push/test", { subscription }, cookie)).status, 401, "INVALID_SESSION_ACCEPTED");
    }
    assert.deepEqual(row(), before, "UNAUTHORIZED_WRITE");
    assert.equal(gatewayCalls, calls, "UNAUTHORIZED_SEND");
  });
  await check("backend push registration requires a verified Bearer principal", async () => {
    assert.equal((await api("PUT", `/api/v1/devices/${installation}/push`, {
      platform: "web", environment: "production", token: JSON.stringify(subscription), userId: owner.id,
    })).status, 401, "UNAUTHENTICATED_BACKEND_WRITE");
  });
  await check("foreign CSRF origin fails before any device write or gateway call", async () => {
    const before = row(); const calls = gatewayCalls;
    assert.equal((await web("/api/push/test", { subscription }, owner.cookie, "https://test_attacker.invalid")).status, 403, "FOREIGN_ORIGIN_ACCEPTED");
    assert.deepEqual(row(), before, "CSRF_DEVICE_WRITE");
    assert.equal(gatewayCalls, calls, "CSRF_GATEWAY_SEND");
  });
  await check("missing current-device subscription fails without mutation or simulated send", async () => {
    const before = row(); const calls = gatewayCalls;
    assert.equal((await web("/api/push/test", { subscription: null })).status, 400, "MISSING_SUBSCRIPTION_ACCEPTED");
    assert.deepEqual(row(), before, "MALFORMED_DEVICE_WRITE");
    assert.equal(gatewayCalls, calls, "MALFORMED_GATEWAY_SEND");
  });
  await check("missing VAPID configuration reports 503 without changing stored subscription", async () => {
    const before = row(); const calls = gatewayCalls;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      assert.equal((await web("/api/push/test", { subscription })).status, 503, "MISSING_CONFIG_SIMULATED_SUCCESS");
      assert.deepEqual(row(), before, "UNCONFIGURED_DEVICE_WRITE");
      assert.equal(gatewayCalls, calls, "UNCONFIGURED_GATEWAY_SEND");
    } finally { process.env.VAPID_PRIVATE_KEY = vapid.privateKey; }
  });
  await check("gateway 403 is reported as 502 while the real PostgreSQL subscription remains valid", async () => {
    gatewayMode = "denied";
    try {
      const response = await web("/api/push/test", { subscription });
      assert.equal(response.status, 502, "GATEWAY_FAILURE_SIMULATED_SUCCESS");
      assert.equal(response.data.success, undefined, "GATEWAY_FAILURE_CLAIMED_SUCCESS");
      assert.equal(response.data.simulated, undefined, "GATEWAY_FAILURE_SIMULATED");
      fullToken();
    } finally { gatewayMode = "accepted"; }
  });
  await check("observe notification task inventory after a real family feeding transaction", async () => {
    const caregiver = await account("caregiver");
    const family = await api("POST", "/api/v1/families", {
      name: `test_family_push_${manifest.runId}`, timeZone: "Asia/Shanghai",
    }, owner.accessToken);
    assert.equal(family.status, 201, "TEST_FAMILY_CREATION_FAILED");
    const familyId = family.data.data.id as string;
    assert.match(familyId, /^[a-f0-9-]{36}$/);
    const invite = await api("POST", `/api/v1/families/${familyId}/invites`, { expiresInDays: 1 }, owner.accessToken);
    assert.equal(invite.status, 201, "TEST_INVITE_FAILED");
    assert.equal((await api("POST", "/api/v1/families/join", { inviteCode: invite.data.data.inviteCode }, caregiver.accessToken)).status,
      200, "TEST_CAREGIVER_JOIN_FAILED");
    const baby = await api("POST", `/api/v1/families/${familyId}/babies`, {
      name: `test_baby_push_${manifest.runId}`, birthDate: "2026-01-02", gender: "girl",
    }, owner.accessToken);
    assert.equal(baby.status, 201, "TEST_BABY_CREATION_FAILED");
    const babyId = baby.data.data.id as string;
    assert.match(babyId, /^[a-f0-9-]{36}$/);
    assert.equal((await api("POST", `/api/v1/babies/${babyId}/members`, {
      userId: caregiver.id, role: "member",
    }, owner.accessToken)).status, 201, "TEST_BABY_PERMISSION_FAILED");
    const recipientSubscription = { ...subscription, endpoint: subscription.endpoint + "_caregiver" };
    assert.equal((await web("/api/push/subscribe", recipientSubscription, caregiver.cookie)).status, 200, "RECIPIENT_SUBSCRIBE_FAILED");
    assert.equal(sql(`SELECT count(*) FROM push_devices WHERE user_id='${caregiver.id}';`), "1", "RECIPIENT_NOT_REGISTERED");
    const inventory = () => JSON.parse(sql(`SELECT jsonb_build_object(
      'notifications',(SELECT count(*) FROM notifications),
      'pushTasks',(SELECT count(*) FROM task_executions WHERE kind='push_delivery'),
      'changes',(SELECT count(*) FROM family_changes WHERE family_id='${familyId}'),
      'records',(SELECT count(*) FROM feeding_records WHERE baby_id='${babyId}'));`));
    const before = inventory();
    const created = await api("POST", `/api/v1/babies/${babyId}/records/feeding`, {
      feedingType: "formula", occurredAt: "2026-05-02T04:00:00Z", amountMl: "120", notes: "test_push_event_probe",
    }, owner.accessToken, `test_push_record_${manifest.runId}`);
    assert.equal(created.status, 201, "REAL_FEEDING_TRANSACTION_FAILED");
    const after = inventory();
    assert.equal(after.records, before.records + 1, "FEEDING_NOT_COMMITTED");
    assert.equal(after.changes, before.changes + 1, "FAMILY_CHANGE_NOT_COMMITTED");
    report.familyRecordNotificationProbe = {
      recordCommitted: true, recipientSubscriptionPresent: true,
      notificationDelta: after.notifications - before.notifications,
      pushTaskDelta: after.pushTasks - before.pushTasks,
      familyChangeDelta: after.changes - before.changes,
      missingEventObserved: after.notifications === before.notifications && after.pushTasks === before.pushTasks,
    };
  });
} catch (error) {
  report.cases.push({ name: "owned route test setup", passed: false, error: error instanceof Error ? error.message.split("\n")[0] : "SETUP_FAILED" });
} finally {
  webPush.sendNotification = originalSend;
  globalThis.fetch = originalFetch;
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  report.gatewayCalls = gatewayCalls;
  report.passed = report.cases.length > 0 && report.cases.every(item => item.passed);
  await writeFile(manifest.resultPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  if (!report.passed) process.exitCode = 1;
}

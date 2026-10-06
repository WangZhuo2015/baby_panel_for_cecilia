import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

// Synthetic UI coverage only: no real permission prompt, push registration,
// authentication, database write, or push provider request is exercised.
const origin = new URL(process.env.TEST_PUSH_WEB || "");
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
assert.ok(origin.port && !["3088", "3089", "5432", "6379"].includes(origin.port));
const ownerPid = Number(process.env.TEST_PUSH_SERVER_PID);
assert.ok(Number.isSafeInteger(ownerPid) && ownerPid > 1, "Require the owned local Next server PID");
process.kill(ownerPid, 0);
const resultPath = process.env.TEST_PUSH_RESULT;
assert.ok(resultPath && path.isAbsolute(resultPath));
const publicKey = Buffer.from([4, ...Array(64).fill(7)]).toString("base64url");
const rotatedKey = Buffer.from([4, ...Array(64).fill(8)]).toString("base64url");
const report = { passed: false, synthetic: true, browser: "chromium", cases: [], failure: null };
const browser = await chromium.launch({ headless: true });

async function scenario(options, check) {
  const context = await browser.newContext({ baseURL: origin.origin, serviceWorkers: "block" });
  const calls = [];
  const state = {
    binding: { status: 200, body: { success: true } },
    test: { status: 200, body: { success: true, sent: 1, simulated: false } },
    publicKey,
    ...options,
  };
  try {
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin.origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname.startsWith("/api/push/")) calls.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
      const baby = { id: "test_push_baby", familyId: "test_push_family", nickname: "test_push_baby", birthDate: "2025-01-01", gender: "female" };
      const values = {
        "/api/auth/me": { user: { id: "test_push_user", username: "test_push_user", displayName: "test_push_user" }, family: { id: "test_push_family", name: "test_push_family", babies: [baby] }, baby },
        "/api/notifications": [],
        "/api/app-config": { swDisabled: false },
        "/api/push/vapid-key": { publicKey: state.publicKey },
      };
      const response = url.pathname === "/api/push/subscribe" ? state.binding
        : url.pathname === "/api/push/test" ? state.test
          : Object.hasOwn(values, url.pathname) ? { status: 200, body: values[url.pathname] }
            : { status: 418, body: { error: "test_push_unexpected_api" } };
      return route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
    });
    await context.addInitScript(({ key, missingRegistration, permission, removal, missingSubscription, stalledRead, stalledSubscribe }) => {
      const counters = { subscribe: 0, unsubscribe: 0, permission: 0 };
      window.testPushCounters = counters;
      let currentPermission = permission;
      Object.defineProperty(window, "Notification", { configurable: true, value: {
        get permission() { return currentPermission; },
        requestPermission: async () => { counters.permission++; currentPermission = permission; return permission; },
      } });
      function subscription(bytes) {
        const endpoint = "https://push.example.invalid/test_push_endpoint_" + counters.subscribe;
        return {
          endpoint,
          options: { applicationServerKey: bytes.buffer },
          toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "test_push_p256dh", auth: "test_push_auth" } }),
          unsubscribe: async () => {
            counters.unsubscribe++;
            if (removal === "stall") return new Promise(() => {});
            if (removal === "reject") throw new Error("test_push_removal_rejected");
            if (removal === "false") return false;
            current = null;
            return true;
          },
        };
      }
      const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
      let current = missingSubscription ? null : subscription(bytes);
      const registration = {
        active: missingRegistration ? null : { state: "activated" },
        pushManager: {
          getSubscription: async () => stalledRead ? await new Promise(() => {}) : current,
          subscribe: async options => {
            counters.subscribe++;
            if (stalledSubscribe) return new Promise(() => {});
            current = subscription(new Uint8Array(options.applicationServerKey));
            return current;
          },
        },
        update: async () => {},
        addEventListener: () => {},
      };
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
        ready: missingRegistration ? new Promise(() => {}) : Promise.resolve(registration),
        register: async () => registration,
        getRegistration: async () => missingRegistration ? undefined : registration,
        getRegistrations: async () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
      } });
    }, {
      key: options.existingKey || publicKey, missingRegistration: Boolean(options.missingRegistration),
      permission: options.permission || "granted", removal: options.removal || "success",
      missingSubscription: Boolean(options.missingSubscription), stalledRead: Boolean(options.stalledRead),
      stalledSubscribe: Boolean(options.stalledSubscribe),
    });
    const page = await context.newPage();
    await page.goto("/notifications");
    await expect(page.getByText("设备推送通知", { exact: true })).toBeVisible();
    await check(page, state, calls);
  } finally {
    await context.close();
  }
}
const pass = name => { report.cases.push(name); console.log("PASS " + name); };
const alert = (page, text) => page.getByRole("alert").filter({ hasText: text });

try {
  await scenario({ binding: { status: 503, body: { error: "test_push_binding_outage" } } }, async (page, state, calls) => {
    await expect(alert(page, "test_push_binding_outage")).toBeVisible();
    await expect(page.getByText("已绑定", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
    await expect(alert(page, "test_push_binding_outage")).toBeVisible();
    assert.equal(calls.filter(call => call.path === "/api/push/test").length, 0);
    state.binding = { status: 200, body: { success: true } };
    await page.getByRole("button", { name: "开启推送通知", exact: true }).click();
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    await expect(alert(page, "test_push_binding_outage")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.testPushCounters), { subscribe: 0, unsubscribe: 0, permission: 0 });
    pass("failed automatic sync stays unbound with a persistent error; retry reuses the subscription");
  });
  await scenario({ binding: { status: 200, body: { success: false } } }, async page => {
    await expect(alert(page, "服务端未确认设备绑定")).toBeVisible();
    await expect(page.getByText("已绑定", { exact: true })).toHaveCount(0);
    pass("HTTP 200 without success true does not confirm binding");
  });
  await scenario({}, async (page, state) => {
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "重新绑定设备", exact: true }).click();
    await expect(page.getByRole("button", { name: "重新绑定设备", exact: true })).toBeEnabled();
    assert.deepEqual(await page.evaluate(() => window.testPushCounters), { subscribe: 0, unsubscribe: 0, permission: 0 });
    for (const [body, message] of [
      [{ success: true, sent: 0, simulated: false }, "推送服务未接受测试通知"],
      [{ success: true, sent: 1, simulated: true }, "当前为模拟推送"],
      [{ success: false, sent: 1, simulated: false }, "推送服务未接受测试通知"],
    ]) {
      state.test = { status: 200, body };
      await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
      await expect(alert(page, message)).toBeVisible();
    }
    state.test = { status: 200, body: { success: true, sent: 1, simulated: false } };
    await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "推送服务已接受测试通知" })).toBeVisible();
    await expect(page.getByText(/家人提交或修改记录/)).toHaveCount(0);
    pass("same-key rebind keeps the subscription; test success requires a real positive accepted count");
  });
  await scenario({ publicKey: rotatedKey }, async page => {
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.testPushCounters), { subscribe: 1, unsubscribe: 1, permission: 0 });
    pass("a changed VAPID key replaces the old subscription once before syncing");
  });
  await scenario({}, async (page, state, calls) => {
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    const previousEndpoint = calls.find(call => call.path === "/api/push/subscribe").body.endpoint;
    state.test = { status: 400, body: { error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" } };
    await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
    await expect(alert(page, "推送订阅已失效")).toBeVisible();
    await expect(page.getByText("已绑定", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "开启推送通知", exact: true }).click();
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    assert.notEqual(calls.filter(call => call.path === "/api/push/subscribe").at(-1).body.endpoint, previousEndpoint);
    assert.deepEqual(await page.evaluate(() => window.testPushCounters), { subscribe: 1, unsubscribe: 1, permission: 0 });
    pass("a provider-confirmed expired endpoint is removed; retry registers a new endpoint once");
  });
  for (const removal of ["false", "reject"]) {
    await scenario({ removal }, async (page, state) => {
      await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
      state.test = { status: 400, body: { error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" } };
      await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
      await expect(alert(page, "重置本站通知权限")).toBeVisible();
      await expect(page.getByText("已绑定", { exact: true })).toHaveCount(0);
      pass("confirmed expired subscription stays unbound when browser removal returns " + removal);
    });
  }
  await scenario({ stalledRead: true }, async (page, state, calls) => {
    await expect(alert(page, "读取推送订阅超时")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: "开启推送通知", exact: true })).toBeEnabled();
    assert.equal(calls.length, 0);
    pass("a stalled subscription read releases the page without contacting push APIs");
  });
  await scenario({ missingSubscription: true, stalledSubscribe: true }, async (page, state, calls) => {
    await expect(page.getByText("暂无通知", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "开启推送通知", exact: true }).click();
    await expect(alert(page, "创建推送订阅超时")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: "开启推送通知", exact: true })).toBeEnabled();
    assert.equal(calls.filter(call => call.path === "/api/push/subscribe").length, 0);
    pass("a stalled subscription creation releases the button without confirming or uploading");
  });
  await scenario({ publicKey: rotatedKey, removal: "stall" }, async (page, state, calls) => {
    await expect(alert(page, "更新推送订阅超时")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: "开启推送通知", exact: true })).toBeEnabled();
    assert.equal(calls.filter(call => call.path === "/api/push/subscribe").length, 0);
    assert.equal((await page.evaluate(() => window.testPushCounters)).subscribe, 0);
    pass("a stalled key-rotation removal releases the page without creating a replacement");
  });
  await scenario({ removal: "stall" }, async (page, state) => {
    await expect(page.getByText("已绑定", { exact: true })).toBeVisible();
    state.test = { status: 400, body: { error: "推送订阅已失效", code: "PUSH_SUBSCRIPTION_GONE" } };
    await page.getByRole("button", { name: "发送测试推送", exact: true }).click();
    await expect(alert(page, "重置本站通知权限")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByText("已绑定", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "开启推送通知", exact: true })).toBeEnabled();
    pass("a stalled expired removal still clears the confirmed binding and shows recovery instructions");
  });
  await scenario({ missingRegistration: true }, async page => {
    await expect(alert(page, "尚未注册推送服务")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "开启推送通知", exact: true }).click();
    await expect(alert(page, "推送服务启动超时")).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: "开启推送通知", exact: true })).toBeEnabled();
    pass("a missing or inactive worker produces an actionable error and a bounded retry");
  });
  report.passed = true;
} catch (error) {
  report.failure = { message: error instanceof Error ? error.message : String(error), ariaSnapshot: error.matcherResult?.ariaSnapshot ?? null };
  throw error;
} finally {
  await browser.close();
  await writeFile(resultPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}

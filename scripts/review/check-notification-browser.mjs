import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { expect } from "@playwright/test";

const manifestPath = process.env.TEST_NOTIFICATION_MANIFEST;
assert.ok(manifestPath && path.isAbsolute(manifestPath), "An owned run manifest is required");
const metadata = await stat(manifestPath);
assert.equal(metadata.mode & 0o077, 0, "Test credentials must be private");
const config = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(config.version, 1);
assert.ok(Number.isSafeInteger(config.ownerPid) && config.ownerPid > 1);
process.kill(config.ownerPid, 0);
const origin = new URL(config.web);
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
assert.ok(origin.port && !["3088", "3089", "5432", "6379"].includes(origin.port));
for (const account of config.accounts) {
  assert.match(account.username, /^test_notification_/);
  for (const field of ["userId", "familyId", "babyId"]) assert.match(account[field], /^[0-9a-f-]{36}$/);
}
assert.equal(path.dirname(config.result), path.dirname(manifestPath));
const [reader, other] = config.accounts;
const [automatic, retry, foreign] = config.notifications;
const report = { passed: false, browser: "chromium", cases: [], syntheticFailure: "Only the retry notification POST is intercepted with HTTP 503" };
const browser = await chromium.launch({ headless: true });
const contexts = [];
const pass = name => { report.cases.push(name); console.log("PASS " + name); };

async function newContext() {
  const context = await browser.newContext({ baseURL: origin.origin, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  contexts.push(context);
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin.origin ? route.continue() : route.abort();
  });
  return context;
}
async function login(context, page, account) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入用户名").fill(account.username);
  await page.getByPlaceholder("请输入密码").fill(account.password);
  const response = page.waitForResponse(response => response.url() === origin.origin + "/api/auth/login" && response.request().method() === "POST");
  await page.locator('button[type="submit"]').click();
  assert.equal((await response).status(), 200);
  await expect(page).toHaveURL(origin.origin + "/", { timeout: 20_000 });
  const cookie = (await context.cookies()).find(item => item.name === "__Host-growdesk_web");
  assert.ok(cookie?.httpOnly && cookie.secure && cookie.path === "/");
  const actual = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    return { status: response.status, id: (await response.json()).user?.id, visibleCookies: document.cookie };
  });
  assert.equal(actual.status, 200);
  assert.equal(actual.id, account.userId);
  assert.ok(!actual.visibleCookies.includes("__Host-growdesk_web"));
}
async function notifications(context, account = reader) {
  const response = await context.request.get("/api/notifications", { params: { babyId: account.babyId, familyId: account.familyId },
    headers: { "x-growdesk-representation": "extended", "x-growdesk-expected-user": account.userId } });
  assert.equal(response.status(), 200);
  return response.json();
}
async function readAt(context, id, account = reader) {
  const item = (await notifications(context, account)).find(item => item.id === id);
  assert.equal(item?.serverNotificationId, id);
  return item.readAt;
}
function card(page, title) {
  return page.getByText(title, { exact: true }).locator("xpath=ancestor::*[contains(@class,'border-l-')][1]");
}
async function assertNotLocallyRead(page, id) {
  const present = await page.evaluate(id => Object.keys(localStorage)
    .filter(key => key.startsWith("notifications-v3:") && (key.endsWith(":baby_read_notifications") || key.endsWith(":notification-read-ids")))
    .some(key => (localStorage.getItem(key) || "").includes(id)), id);
  assert.equal(present, false, "Server-backed read must not be faked in localStorage");
}

try {
  const first = await newContext();
  const page = await first.newPage();
  const deniedUrl = origin.origin + "/api/notifications/" + retry.id;
  await first.route(deniedUrl, route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "test_read_outage" }) })
    : route.continue());
  await login(first, page, reader);
  pass("real login form and browser-managed Secure/HttpOnly BFF cookie");
  await page.goto("/notifications");
  await expect(page.getByText(automatic.title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => readAt(first, automatic.id), { timeout: 20_000 }).not.toBeNull();
  const firstReadAt = await readAt(first, automatic.id);
  assert.equal(await readAt(first, retry.id), null);
  await expect(card(page, retry.title)).toHaveClass(/ring-1/);
  await assertNotLocallyRead(page, retry.id);
  await expect(page.getByText(foreign.title, { exact: true })).toHaveCount(0);
  pass("page auto-read reaches native storage while a failed read stays unread and isolated");

  await card(page, retry.title).getByTitle("清除此条通知").click();
  await expect(page.getByText("部分通知已读状态未保存，请重试；未将失败结果标记为成功", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(retry.title, { exact: true })).toBeVisible();
  assert.equal(await readAt(first, retry.id), null);
  await assertNotLocallyRead(page, retry.id);
  await first.unroute(deniedUrl);
  await card(page, retry.title).getByTitle("清除此条通知").click();
  await expect(page.getByText(retry.title, { exact: true })).toHaveCount(0);
  assert.notEqual(await readAt(first, retry.id), null);
  await card(page, automatic.title).getByTitle("清除此条通知").click();
  await expect(page.getByText(automatic.title, { exact: true })).toHaveCount(0);
  pass("failed clear does not hide the item; retry persists read then clears only this browser");

  const second = await newContext();
  const secondPage = await second.newPage();
  await login(second, secondPage, reader);
  assert.equal(await readAt(second, automatic.id), firstReadAt);
  await secondPage.goto("/notifications");
  await expect(secondPage.getByText(automatic.title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(card(secondPage, automatic.title)).not.toHaveClass(/ring-1/);
  assert.equal(await readAt(second, automatic.id), firstReadAt);
  await assertNotLocallyRead(secondPage, automatic.id);
  pass("a fresh browser retains server readAt but not another browser's local dismissal");

  await second.request.post("/api/auth/logout", { headers: { origin: origin.origin } });
  await login(second, secondPage, other);
  const oldRead = await second.request.post(`/api/notifications/${automatic.id}`, {
    headers: { origin: origin.origin, "x-growdesk-expected-user": reader.userId },
  });
  assert.equal(oldRead.status(), 409);
  const oldList = await second.request.get("/api/notifications", { headers: { "x-growdesk-expected-user": reader.userId } });
  assert.equal(oldList.status(), 409);
  await secondPage.goto("/notifications");
  await expect(secondPage.getByText(foreign.title, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(secondPage.getByText(automatic.title, { exact: true })).toHaveCount(0);
  pass("account switch rejects stale expected-user requests and renders only the new user's inbox");
  report.passed = true;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  await writeFile(config.result, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
}

#!/usr/bin/env node

/**
 * Destructive UI parity acceptance for an isolated GrowDesk compatibility stack.
 *
 * Required:
 *   UI_BASE_URL=http://127.0.0.1:<non-3088-port> node scripts/review/ui-parity-acceptance.mjs
 *
 * The script deliberately refuses remote hosts and port 3088. It creates only an
 * e2e_* tenant and drives the real browser UI; it never intercepts or mocks APIs.
 */
import { chromium } from "playwright";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.UI_BASE_URL;
if (!baseURL) throw new Error("UI_BASE_URL is required; wait for the isolated localhost stack address");
const runManifestPath = process.env.UI_RUN_MANIFEST;
if (!runManifestPath || !path.isAbsolute(runManifestPath)) {
  throw new Error("UI_RUN_MANIFEST must be an absolute path supplied by the owned isolated stack");
}
const parsed = new URL(baseURL);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
  throw new Error(`Refusing non-loopback UI_BASE_URL: ${parsed.origin}`);
}
if (parsed.port === "3088") throw new Error("Refusing production port 3088");
if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("UI_BASE_URL must use http(s)");

const manifestStat = await stat(runManifestPath);
if (!manifestStat.isFile()) throw new Error("UI_RUN_MANIFEST is not a regular file");
if ((manifestStat.mode & 0o077) !== 0) throw new Error("UI_RUN_MANIFEST must not be accessible by group/other users");
const runManifest = JSON.parse(await readFile(runManifestPath, "utf8"));
if (runManifest?.version !== 1 || typeof runManifest?.runId !== "string" || !runManifest.runId) {
  throw new Error("UI_RUN_MANIFEST has an unsupported or incomplete identity");
}
if (runManifest.uiBaseUrl !== parsed.origin || runManifest.bffOrigin !== parsed.origin) {
  throw new Error("UI_BASE_URL does not match the owned run manifest");
}
if (!Number.isSafeInteger(runManifest.ownerPid) || runManifest.ownerPid <= 1) {
  throw new Error("UI_RUN_MANIFEST ownerPid is invalid");
}
try {
  process.kill(runManifest.ownerPid, 0);
} catch {
  throw new Error("UI_RUN_MANIFEST owner process is not alive");
}
const apiURL = new URL(runManifest.apiBaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(apiURL.hostname) || apiURL.port === "3088") {
  throw new Error("Owned API must use a loopback, non-3088 address");
}
const database = runManifest.database;
if (!database || !["127.0.0.1", "localhost", "::1"].includes(database.host)) {
  throw new Error("Owned database must use loopback PostgreSQL");
}
const databaseName = String(database.name || database.database || "");
const databaseRole = String(database.role || "");
if (!/(test|e2e|parity)/i.test(databaseName) || !/(test|e2e|parity)/i.test(databaseRole)) {
  throw new Error(`Refusing non-test database identity: ${databaseRole}/${databaseName}`);
}
if (!runManifest.redis || !["127.0.0.1", "localhost", "::1"].includes(runManifest.redis.host)) {
  throw new Error("Owned Redis must use loopback");
}
if (!path.isAbsolute(runManifest.environmentManifest || "")) {
  throw new Error("Owned environment manifest path is missing");
}
await stat(runManifest.environmentManifest);

const buildProvenancePath = path.resolve(".next/standalone/build-provenance.json");
const buildProvenance = JSON.parse(await readFile(buildProvenancePath, "utf8").catch(() => {
  throw new Error(`Missing existing Web build provenance: ${buildProvenancePath}`);
}));
for (const field of ["artifactSha256", "buildId", "sourceGitSha"]) {
  if (typeof buildProvenance?.[field] !== "string" || !buildProvenance[field]) {
    throw new Error(`Web build provenance is missing ${field}`);
  }
}
if (typeof buildProvenance.sourceDirty !== "boolean") {
  throw new Error("Web build provenance is missing boolean sourceDirty");
}

const evidenceDir = path.resolve("evidence/tasks/WEB_PARITY_20260919/ui");
await mkdir(evidenceDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const suffix = `${Date.now()}_${process.pid}`;
const account = {
  username: `e2e_parity_${suffix}`,
  password: "E2eParity!2026",
  displayName: `test_p${suffix.slice(-8)}`,
  baby: `test_b${suffix.slice(-6)}`,
};
const fixture = {
  username: `e2e_family_${suffix}`,
  password: "E2eFamily!2026",
  displayName: `test_family_owner_${suffix.slice(-8)}`,
  baby: `test_f${suffix.slice(-6)}`,
};
const marks = {
  feeding: `e2e_feed_${suffix}`,
  feedingEdited: `e2e_feed_edit_${suffix}`,
  offlineFeeding: `e2e_offline_feed_${suffix}`,
  diaper: `e2e_diaper_${suffix}`,
  sleep: `e2e_sleep_${suffix}`,
  food: `test_food_${suffix.slice(-8)}`,
  foodAbnormal: `e2e_food_reaction_${suffix.slice(-8)}`,
  supplement: `test_supp_${suffix.slice(-8)}`,
  medical: `e2e_medical_${suffix}`,
};
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const report = { baseURL: parsed.origin, runId: runManifest.runId, buildProvenance, account: account.username, startedAt: new Date().toISOString(), steps: [], console: [], network: [], avatarDiagnostic: {}, foodDiagnostic: {}, growthDiagnostic: {}, medicalDiagnostic: {}, sleepDiagnostic: {} };

const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await access(chromeExecutable).catch(() => {
  throw new Error(`No existing local Chromium executable found at ${chromeExecutable}; refusing to install globally`);
});
const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: process.env.HEADED !== "1",
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: parsed.origin });
const page = await context.newPage();
let expectedNetworkPhase = null;
const offlineReadPaths = new Set([
  "/api/records/daily-summary",
  "/api/ai/daily-summary",
  "/api/records/timeline",
  "/api/records/feeding",
  "/api/records/sleep",
  "/api/records/diaper",
  "/api/food/logs",
  "/api/growth",
  "/api/medical/reports",
  "/api/app-config",
  "/api/agent/voice/logs",
  "/api/auth/me",
  "/api/weather",
]);
const offlineConsolePrefixes = new Map([
  ["Failed to fetch daily summary:", "/api/records/daily-summary"],
  ["Failed to fetch AI daily summary:", "/api/ai/daily-summary"],
  ["Failed to fetch timeline:", "/api/records/timeline"],
  ["Failed to fetch feeding records:", "/api/records/feeding"],
  ["Failed to fetch sleep records:", "/api/records/sleep"],
  ["Failed to fetch diaper records:", "/api/records/diaper"],
  ["Failed to fetch food log records:", "/api/food/logs"],
  ["Failed to fetch growth measurements:", "/api/growth"],
  ["Failed to fetch medical reports:", "/api/medical/reports"],
  ["Failed to fetch weather:", "/api/weather"],
]);
const unmatchedOfflineResourceFailures = [];
page.on("console", (msg) => {
  if (!["error", "warning"].includes(msg.type())) return;
  const item = { type: msg.type(), text: msg.text(), url: page.url(), locationUrl: msg.location().url || null };
  if (expectedNetworkPhase === "offline-window" && msg.type() === "error") {
    const relatedPath = Array.from(offlineConsolePrefixes).find(([prefix]) => msg.text().startsWith(prefix))?.[1];
    if (relatedPath) {
      Object.assign(item, { expectedCandidate: "offline-read-503", relatedPath });
    } else if (msg.text() === "Failed to load resource: the server responded with a status of 503 ()") {
      const relatedUrl = unmatchedOfflineResourceFailures.shift();
      if (relatedUrl) Object.assign(item, { expectedCandidate: "offline-read-503", relatedUrl });
    } else if (msg.text() === "Failed to load resource: net::ERR_INTERNET_DISCONNECTED") {
      Object.assign(item, { expectedCandidate: "offline-submit" });
    }
  }
  report.console.push(item);
});
page.on("pageerror", (error) => report.console.push({ type: "pageerror", text: error.message, url: page.url() }));
page.on("requestfailed", (request) => {
  const requestPath = new URL(request.url()).pathname;
  const expected = expectedNetworkPhase === "offline-window"
    && request.method() === "POST"
    && requestPath === "/api/records/feeding"
    ? "offline-submit"
    : undefined;
  report.network.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText, ...(expected ? { expected } : {}) });
});
page.on("response", (response) => {
  if (response.status() < 400) return;
  const method = response.request().method();
  const responsePath = new URL(response.url()).pathname;
  const expected = expectedNetworkPhase === "offline-window"
    && method === "GET"
    && response.status() === 503
    && (offlineReadPaths.has(responsePath) || new URL(response.url()).searchParams.has("_rsc"))
    ? "offline-read-503"
    : undefined;
  if (expected) unmatchedOfflineResourceFailures.push(response.url());
  report.network.push({ method, url: response.url(), status: response.status(), ...(expected ? { expected } : {}) });
});
page.on("dialog", async (dialog) => dialog.accept());

const safeName = (value) => value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
async function shot(name) {
  await page.screenshot({ path: path.join(evidenceDir, `${stamp}-${safeName(name)}.png`), fullPage: true });
}
async function step(name, fn) {
  const item = { name, startedAt: new Date().toISOString() };
  report.steps.push(item);
  try {
    await fn();
    item.status = "PASS";
  } catch (error) {
    item.status = "FAIL";
    item.error = error instanceof Error ? error.message : String(error);
    await shot(`FAIL-${name}`).catch(() => {});
  }
  item.finishedAt = new Date().toISOString();
}
async function visibleText(text, timeout = 15_000) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout });
}
async function goto(route, expected) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  if (expected) await visibleText(expected);
}
async function reloadAndSee(text) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await visibleText(text);
}
async function clickRecord(mark) {
  const record = page.getByText(mark, { exact: false }).first();
  await record.waitFor({ state: "visible" });
  await record.click();
  await page.getByRole("dialog", { name: "记录操作" }).waitFor({ state: "visible" });
}
async function waitSelected(locator, label) {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate((element, expected) => {
    if (!element.className.includes("bg-primary-soft")) throw new Error(`${expected} is not selected yet`);
  }, label).catch(async () => {
    await page.waitForFunction(
      ({ text }) => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes(text) && button.className.includes("bg-primary-soft")),
      { text: label },
      { timeout: 10_000 },
    );
  });
}
async function isolatedApi(route, { method = "GET", token, body } = {}) {
  const response = await page.request.fetch(`${apiURL.origin}${route}`, {
    method,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    data: body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok()) throw new Error(`${method} ${route} returned ${response.status()}: ${JSON.stringify(payload)}`);
  return payload?.data ?? payload;
}

let secondFamilyInvite;
let secondFamilyId;
let secondBabyId;
let secondFamilyOwnerToken;
let ownerContext;

try {
  await step("stack-preflight", async () => {
    const response = await page.request.get(`${parsed.origin}/api/app-config`);
    if (!response.ok()) throw new Error(`/api/app-config returned ${response.status()}`);
  });

  await step("register-and-onboard", async () => {
    await goto("/register", "加入宝宝成长工作台");
    await page.getByPlaceholder("英文字母或数字，如 yeye123").fill(account.username);
    await page.getByPlaceholder("请设置 8 位及以上密码").fill(account.password);
    await page.getByPlaceholder("自定义称呼，如：安安爸爸、大宝姥姥").fill(account.displayName);
    await page.getByRole("button", { name: "创建账号与家庭空间" }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await page.getByPlaceholder("如：糖糖、果果、安安…").fill(account.baby);
    await page.locator('input[type="date"]').fill("2026-03-01");
    await page.getByRole("button", { name: "开始使用" }).click();
    await page.getByRole("button", { name: "进入今日看板开始记录" }).click();
    await visibleText(account.baby);
    await shot("01-onboarded-dashboard");
  });

  await step("baby-avatar-crop-upload-refresh", async () => {
    const avatarEnabled = runManifest.storage?.s3Covered === true
      && runManifest.storage?.driver === "owned-minio";
    if (!avatarEnabled) {
      report.avatarDiagnostic = {
        status: "SKIP",
        reason: "owned run manifest does not prove real MinIO/S3 coverage",
        storage: runManifest.storage || null,
      };
      return;
    }
    report.avatarDiagnostic = { status: "RUNNING", storage: runManifest.storage };
    await goto("/onboarding", "宝宝资料与头像");
    await page.getByRole("button", { name: "保存修改" }).waitFor({ state: "visible" });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("保存修改") && !button.disabled));

    const fixtureBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    {
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: `e2e_avatar_${suffix}.png`,
        mimeType: "image/png",
        buffer: fixtureBuffer,
      });
      const cropImage = page.getByAltText("待裁剪头像");
      await cropImage.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForFunction(() => {
        const image = document.querySelector('img[alt="待裁剪头像"]');
        return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      });
      const avatarUploadPromise = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/baby/avatar");
      const avatarFirstDownloadPromise = page.waitForResponse((response) => response.request().method() === "GET"
        && /^\/api\/attachments\/[0-9a-f-]+$/i.test(new URL(response.url()).pathname));
      await page.getByRole("button", { name: "确定裁剪头像" }).click();
      const avatarUpload = await avatarUploadPromise;
      const avatarBody = await avatarUpload.json().catch(() => null);
      report.avatarDiagnostic.uploadStatus = avatarUpload.status();
      report.avatarDiagnostic.attachmentId = avatarBody?.attachmentId || null;
      report.avatarDiagnostic.avatarUrl = avatarBody?.avatarUrl || null;
      if (avatarUpload.status() !== 200
        || typeof avatarBody?.attachmentId !== "string"
        || avatarBody?.avatarUrl !== `/api/attachments/${avatarBody.attachmentId}`) {
        throw new Error(`avatar crop upload did not return a protected attachment: ${avatarUpload.status()} ${JSON.stringify(avatarBody)}`);
      }
      const avatarPath = avatarBody.avatarUrl;
      const firstDownload = await avatarFirstDownloadPromise;
      if (new URL(firstDownload.url()).pathname !== avatarPath) {
        throw new Error(`avatar displayed a different protected attachment: ${firstDownload.url()}`);
      }
      const onboardingAvatar = page.getByAltText("宝宝头像", { exact: true });
      await onboardingAvatar.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForFunction((expectedPath) => {
        const image = document.querySelector('img[alt="宝宝头像"]');
        return image instanceof HTMLImageElement
          && new URL(image.src).pathname === expectedPath
          && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      }, avatarPath);
      const onboardingDimensions = await onboardingAvatar.evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        src: image.getAttribute("src"),
      }));
      report.avatarDiagnostic.firstDisplay = {
        status: firstDownload.status(),
        contentType: firstDownload.headers()["content-type"] || null,
        cacheControl: firstDownload.headers()["cache-control"] || null,
        nosniff: firstDownload.headers()["x-content-type-options"] || null,
        dimensions: onboardingDimensions,
      };
      if (firstDownload.status() !== 200
        || !report.avatarDiagnostic.firstDisplay.contentType?.startsWith("image/jpeg")
        || !report.avatarDiagnostic.firstDisplay.cacheControl?.includes("private")
        || !report.avatarDiagnostic.firstDisplay.cacheControl?.includes("no-store")
        || report.avatarDiagnostic.firstDisplay.nosniff !== "nosniff"
        || !onboardingDimensions.complete || onboardingDimensions.naturalWidth < 1 || onboardingDimensions.naturalHeight < 1
        || new URL(onboardingDimensions.src, parsed.origin).pathname !== avatarPath) {
        throw new Error(`cropped avatar did not render through the protected BFF: ${JSON.stringify(report.avatarDiagnostic.firstDisplay)}`);
      }
      await shot("01-avatar-cropped-first-display");

      await page.getByRole("button", { name: "保存修改" }).click();
      await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
      const refreshedDownloadPromise = page.waitForResponse((response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === avatarPath);
      await page.reload({ waitUntil: "domcontentloaded" });
      const refreshedDownload = await refreshedDownloadPromise;
      const dashboardAvatar = page.getByAltText(account.baby, { exact: true }).first();
      await dashboardAvatar.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForFunction(({ expectedAlt, expectedPath }) => {
        const image = Array.from(document.querySelectorAll("img")).find((item) => item.alt === expectedAlt
          && new URL(item.src).pathname === expectedPath);
        return image instanceof HTMLImageElement
          && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
      }, { expectedAlt: account.baby, expectedPath: avatarPath });
      const refreshedDimensions = await dashboardAvatar.evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        src: image.getAttribute("src"),
      }));
      report.avatarDiagnostic.refreshedDisplay = { status: refreshedDownload.status(), dimensions: refreshedDimensions };
      if (refreshedDownload.status() !== 200
        || !refreshedDimensions.complete || refreshedDimensions.naturalWidth < 1 || refreshedDimensions.naturalHeight < 1
        || new URL(refreshedDimensions.src, parsed.origin).pathname !== avatarPath) {
        throw new Error(`protected avatar did not survive dashboard refresh: ${JSON.stringify(report.avatarDiagnostic.refreshedDisplay)}`);
      }
      const anonymousContext = await browser.newContext({ baseURL: parsed.origin });
      try {
        const anonymousResponse = await anonymousContext.request.get(avatarPath);
        report.avatarDiagnostic.anonymousStatus = anonymousResponse.status();
        if (![401, 403].includes(anonymousResponse.status())) {
          throw new Error(`protected avatar was readable without a session: ${anonymousResponse.status()}`);
        }
      } finally {
        await anonymousContext.close();
      }
      report.avatarDiagnostic.status = "PASS";
      await shot("01-avatar-refreshed-protected");
    }
  });

  await step("create-second-isolated-family-fixture", async () => {
    const registration = await isolatedApi("/api/v1/auth/register", {
      method: "POST",
      body: { username: fixture.username, password: fixture.password, displayName: fixture.displayName },
    });
    if (!registration?.accessToken) throw new Error("isolated API registration did not return an access token");
    secondFamilyOwnerToken = registration.accessToken;
    const families = await isolatedApi("/api/v1/families", { token: registration.accessToken });
    const family = families.find((item) => item.name.startsWith("test_"));
    if (!family?.id) throw new Error("isolated test family was not returned");
    secondFamilyId = family.id;
    const createdBaby = await isolatedApi(`/api/v1/families/${encodeURIComponent(family.id)}/babies`, {
      method: "POST",
      token: registration.accessToken,
      body: { name: fixture.baby, birthDate: "2026-03-02", gender: "girl" },
    });
    secondBabyId = createdBaby?.id;
    if (!secondBabyId) throw new Error("isolated second-family baby was not returned");
    const invite = await isolatedApi(`/api/v1/families/${encodeURIComponent(family.id)}/invites`, {
      method: "POST",
      token: registration.accessToken,
      body: { expiresInDays: 1 },
    });
    secondFamilyInvite = invite?.inviteCode;
    if (!secondFamilyInvite) throw new Error("isolated second family invite was not returned");
  });

  await step("feeding-create-refresh-edit", async () => {
    await goto("/records/feeding", "记录喂养");
    await page.getByPlaceholder("如：吃得很香 / 拍嗝顺畅 / 换了新奶嘴").fill(marks.feeding);
    await page.getByRole("button", { name: "保存喂养记录" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await visibleText(marks.feeding);
    await reloadAndSee(marks.feeding);
    await clickRecord(marks.feeding);
    await page.getByRole("button", { name: "修改这条记录" }).click();
    const notes = page.getByPlaceholder("如：吃得很香 / 拍嗝顺畅 / 换了新奶嘴");
    await notes.fill(marks.feedingEdited);
    await page.getByRole("button", { name: "保存修改" }).click();
    await visibleText(marks.feedingEdited);
    await reloadAndSee(marks.feedingEdited);
    await shot("02-feeding-edited-persisted");
  });

  await step("offline-feeding-outbox-sync-delete", async () => {
    await goto("/records/feeding", "记录喂养");
    await page.getByPlaceholder("如：吃得很香 / 拍嗝顺畅 / 换了新奶嘴").fill(marks.offlineFeeding);
    try {
      expectedNetworkPhase = "offline-window";
      await context.setOffline(true);
      await page.getByRole("button", { name: "保存喂养记录" }).click();
      await visibleText("当前离线，记录已保存，联网后自动同步", 10_000);
      // An offline save is deliberately surfaced as a retained draft error, so
      // the form stays put. Open the cached main shell through normal browser
      // navigation to inspect its global OfflineBanner.
      await page.getByRole("button", { name: "返回" }).click();
      await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
      const offlineStatus = page.getByRole("status").filter({ hasText: /当前离线|1\s*条记录待同步/ }).first();
      await offlineStatus.waitFor({ state: "visible", timeout: 10_000 });
      report.offlineDiagnostic = { bannerText: (await offlineStatus.innerText()).trim() };
      await shot("02-offline-feeding-pending-sync");

      const replay = page.waitForResponse((response) =>
        response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/records/feeding"
          && response.status() === 201,
      { timeout: 75_000 });
      await context.setOffline(false);
      expectedNetworkPhase = null;
      await replay;
    } finally {
      expectedNetworkPhase = null;
      await context.setOffline(false).catch(() => {});
    }

    await goto("/", marks.offlineFeeding);
    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleText(marks.offlineFeeding);
    const synced = page.getByText(marks.offlineFeeding, { exact: false });
    const syncedCount = await synced.count();
    if (syncedCount !== 1) throw new Error(`offline feeding replay produced ${syncedCount} visible records; expected exactly 1`);
    await shot("02-offline-feeding-synced-once");
    await clickRecord(marks.offlineFeeding);
    await page.getByRole("button", { name: "删除这条记录" }).click();
    await synced.first().waitFor({ state: "detached", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(marks.offlineFeeding, { exact: false }).count()) {
      throw new Error("deleted offline feeding returned after refresh");
    }
  });

  await step("diaper-create-refresh-delete", async () => {
    await goto("/records/diaper", "尿布记录");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("保存记录") && !button.disabled));
    const poopButton = page.locator("button").filter({ hasText: /^\s*💩\s*便便\s*$/ });
    await poopButton.click();
    const selectedPoopClasses = (await poopButton.getAttribute("class") || "").split(/\s+/);
    if (!selectedPoopClasses.includes("bg-primary")) throw new Error("diaper poop type was not selected by the UI");
    const diaperNotes = page.getByPlaceholder("记录一下宝宝臀部情况或特殊细节...");
    await diaperNotes.fill(marks.diaper);
    if (await diaperNotes.inputValue() !== marks.diaper) throw new Error("diaper notes did not retain the entered marker");
    await page.getByRole("button", { name: "保存记录" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await visibleText(marks.diaper);
    await reloadAndSee(marks.diaper);
    await clickRecord(marks.diaper);
    await page.getByRole("button", { name: "删除这条记录" }).click();
    await page.getByText(marks.diaper, { exact: false }).first().waitFor({ state: "detached", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(marks.diaper, { exact: false }).count()) throw new Error("deleted diaper returned after refresh");
    await shot("03-diaper-deleted-persisted");
  });

  await step("historical-sleep-create-refresh-delete", async () => {
    await goto("/records/sleep", "睡眠记录");
    const times = page.locator('input[type="time"]:visible');
    const timeCount = await times.count();
    if (timeCount < 2) throw new Error("sleep form did not expose start and end time fields");
    const startTime = times.nth(timeCount - 2);
    const endTime = times.nth(timeCount - 1);
    await startTime.fill("20:15");
    await endTime.fill("21:05");
    if (await startTime.inputValue() !== "20:15" || await endTime.inputValue() !== "21:05") {
      throw new Error("sleep start/end time fields did not retain entered values");
    }
    await page.locator('input[type="date"]').fill(today);
    await page.getByPlaceholder("如：哄睡顺畅 / 易惊醒 / 换了睡袋").fill(marks.sleep);
    const sleepPost = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/records/sleep", { timeout: 20_000 });
    const sleepTimeline = page.waitForResponse((response) => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/records/timeline", { timeout: 20_000 }).catch(() => null);
    await page.getByRole("button", { name: "保存睡眠记录" }).click();
    const postedSleep = await sleepPost;
    report.sleepDiagnostic.postStatus = postedSleep.status();
    report.sleepDiagnostic.postPayload = postedSleep.request().postDataJSON();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    const timelineResponse = await sleepTimeline;
    if (timelineResponse) {
      report.sleepDiagnostic.timelineUrl = timelineResponse.url();
      report.sleepDiagnostic.timelineStatus = timelineResponse.status();
      const timelineBody = await timelineResponse.json().catch(() => null);
      const rows = Array.isArray(timelineBody) ? timelineBody : [];
      report.sleepDiagnostic.timelineSleepRows = rows.filter((row) => row?.type === "sleep").map((row) => ({
        id: row.id,
        time: row.time,
        detail: row.detail,
        notes: row.rawRecord?.notes,
      }));
    }
    await visibleText(marks.sleep);
    await reloadAndSee(marks.sleep);
    await clickRecord(marks.sleep);
    await page.getByRole("button", { name: "删除这条记录" }).click();
    await page.getByText(marks.sleep, { exact: false }).first().waitFor({ state: "detached", timeout: 15_000 });
    await shot("04-historical-sleep-deleted");
  });

  await step("food-acceptance-abnormal-create-refresh-delete", async () => {
    report.foodDiagnostic = {};
    await goto("/food/log", "辅食记录");
    await page.getByRole("button", { name: "+ 添加新食材" }).click();
    const newFoodInput = page.getByPlaceholder("输入食材名称，如：山药、猪肝…");
    await newFoodInput.click();
    await newFoodInput.pressSequentially(marks.food);
    await newFoodInput.blur();
    if (await newFoodInput.inputValue() !== marks.food) throw new Error("custom food name did not persist after typing and blur");
    await page.evaluate(() => {
      window.__foodUiDiagnostic = { clicks: [], texts: [] };
      const collectText = () => {
        const bodyText = document.body.innerText;
        for (const text of ["请先选择家庭", "请输入食材名称", "已添加到食材库", "添加失败，请重试"]) {
          if (bodyText.includes(text) && !window.__foodUiDiagnostic.texts.includes(text)) window.__foodUiDiagnostic.texts.push(text);
        }
      };
      document.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest("button") : null;
        if (target) window.__foodUiDiagnostic.clicks.push(target.textContent?.replace(/\s+/g, " ").trim() || "");
      }, { capture: true, once: true });
      window.__foodUiDiagnostic.observer = new MutationObserver(collectText);
      window.__foodUiDiagnostic.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      collectText();
    });
    report.foodDiagnostic.inputValueBeforeConfirm = await newFoodInput.inputValue();
    const foodItemRequest = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/food/items", { timeout: 20_000 }).catch(() => null);
    const confirmButton = page.getByRole("button", { name: "确认添加" });
    report.foodDiagnostic.confirmDisabled = await confirmButton.isDisabled();
    await confirmButton.click();
    const earlyRequest = await Promise.race([
      foodItemRequest,
      new Promise((resolve) => setTimeout(() => resolve(null), 2_200)),
    ]);
    const domDiagnostic = await page.evaluate(() => {
      window.__foodUiDiagnostic?.observer?.disconnect();
      return { clicks: window.__foodUiDiagnostic?.clicks || [], texts: window.__foodUiDiagnostic?.texts || [] };
    });
    report.foodDiagnostic.clickedTargets = domDiagnostic.clicks;
    report.foodDiagnostic.toastsWithin2s = domDiagnostic.texts;
    if (!earlyRequest) {
      throw new Error(`custom food confirm emitted no POST within 2s: ${JSON.stringify(report.foodDiagnostic)}`);
    }
    const foodItemResponse = await earlyRequest.response();
    if (!foodItemResponse) throw new Error("custom food request completed without an HTTP response");
    report.foodDiagnostic.itemCreateStatus = foodItemResponse.status();
    if (!foodItemResponse.ok()) throw new Error(`custom food create returned ${foodItemResponse.status()}`);
    const foodChoice = page.getByRole("button", { name: new RegExp(marks.food) });
    await foodChoice.waitFor({ state: "visible" });
    // Exercise the real chooser after the async custom-food refresh so the
    // selected meal state is proven independently of the create response.
    await foodChoice.click();
    await foodChoice.click();
    await foodChoice.evaluate((button) => {
      if (!button.className.split(/\s+/).includes("bg-primary")) throw new Error("custom food did not remain selected");
    });
    await page.getByRole("button", { name: "4 hearts" }).click();
    await page.getByRole("button", { name: /有异常 \/ 泛红/ }).click();
    await page.getByPlaceholder("请详细描述异常情况，如嘴周泛红、起疹子、腹泻等...").fill(marks.foodAbnormal);
    const foodResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/food/logs", { timeout: 20_000 });
    await page.getByRole("button", { name: "保存辅食记录" }).click();
    const foodResponse = await foodResponsePromise;
    const foodPayload = foodResponse.request().postDataJSON();
    report.foodDiagnostic = {
      status: foodResponse.status(),
      postedBabyId: typeof foodPayload?.babyId === "string" && foodPayload.babyId.length > 0,
      postedAcceptance: foodPayload?.acceptance,
      postedAbnormalNotes: foodPayload?.abnormalNotes,
    };
    if (!foodResponse.ok()) throw new Error(`food create returned ${foodResponse.status()}`);
    await goto("/food", "辅食食谱与日记");
    await visibleText(marks.food);
    await visibleText("4 / 5 星");
    await visibleText(marks.foodAbnormal);
    await reloadAndSee(marks.foodAbnormal);
    await visibleText("4 / 5 星");
    const foodCard = page.getByText(marks.foodAbnormal, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][.//button[@title='删除该条辅食记录']][1]");
    await foodCard.getByRole("button", { name: "删除该条辅食记录" }).click();
    await page.getByText(marks.foodAbnormal, { exact: true }).waitFor({ state: "detached", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(marks.foodAbnormal, { exact: true }).count()) throw new Error("deleted food log returned after refresh");
    await shot("05-food-acceptance-abnormal-deleted");
  });

  await step("growth-historical-create-refresh-delete", async () => {
    const growthImageEnabled = runManifest.storage?.s3Covered === true
      && runManifest.storage?.driver === "owned-minio"
      && runManifest.externalAi?.realProviderCovered === false;
    report.growthDiagnostic.imageScenario = growthImageEnabled
      ? { status: "RUNNING", storage: runManifest.storage, externalAi: runManifest.externalAi }
      : {
          status: "SKIP",
          reason: "owned run manifest does not prove real MinIO/S3 coverage and virtual external AI isolation",
          storage: runManifest.storage || null,
          externalAi: runManifest.externalAi || null,
        };
    await goto("/growth/add", "添加测量记录");
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) =>
      button.textContent?.includes("保存测量记录") && !button.disabled));
    let protectedGrowthImagePath = null;
    if (growthImageEnabled) {
      await page.getByRole("tab", { name: /拍照识别/ }).click();
      const fixtureBuffer = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      );
      const growthOcrPromise = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/growth/ocr");
      await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
        name: `e2e_growth_${suffix}.png`,
        mimeType: "image/png",
        buffer: fixtureBuffer,
      });
      const growthOcr = await growthOcrPromise;
      const growthOcrBody = await growthOcr.json().catch(() => null);
      Object.assign(report.growthDiagnostic.imageScenario, {
        ocrStatus: growthOcr.status(),
        attachmentId: growthOcrBody?.attachmentId || null,
        imageUrl: growthOcrBody?.imageUrl || null,
        ocrRecognitionQualityCovered: false,
      });
      if (growthOcr.status() !== 200
        || typeof growthOcrBody?.attachmentId !== "string"
        || growthOcrBody?.imageUrl !== `/api/attachments/${growthOcrBody.attachmentId}`) {
        throw new Error(`growth OCR did not archive the browser-selected image: ${growthOcr.status()} ${JSON.stringify(growthOcrBody)}`);
      }
      protectedGrowthImagePath = growthOcrBody.imageUrl;
      const growthPreview = page.getByAltText("测量照片预览");
      await growthPreview.waitFor({ state: "visible", timeout: 15_000 });
      const previewDimensions = await growthPreview.evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      }));
      report.growthDiagnostic.imageScenario.previewDimensions = previewDimensions;
      if (!previewDimensions.complete || previewDimensions.naturalWidth < 1 || previewDimensions.naturalHeight < 1) {
        throw new Error(`growth selected image did not render a valid preview: ${JSON.stringify(previewDimensions)}`);
      }
    }
    // The isolated virtual OCR intentionally supplies no measurements. Enter
    // the historical values through the real form after OCR completes.
    await page.locator('input[type="date"]').fill("2026-09-18");
    await page.getByPlaceholder("例: 7.35").fill("7.42");
    await page.getByPlaceholder("例: 67.2").fill("67.8");
    await page.getByPlaceholder("例: 42.1").fill("42.3");
    const growthCreatePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/growth");
    await page.getByRole("button", { name: "保存测量记录" }).click();
    const growthCreate = await growthCreatePromise;
    const growthCreatePayload = growthCreate.request().postDataJSON();
    report.growthDiagnostic.createStatus = growthCreate.status();
    report.growthDiagnostic.createdImageUrl = growthCreatePayload?.imageUrl || null;
    if (growthCreate.status() !== 201) throw new Error(`growth create returned ${growthCreate.status()}`);
    if (protectedGrowthImagePath && growthCreatePayload?.imageUrl !== protectedGrowthImagePath) {
      throw new Error(`growth create did not persist the OCR attachment URL: ${JSON.stringify(growthCreatePayload?.imageUrl)}`);
    }
    await page.waitForURL((url) => url.pathname === "/growth", { timeout: 20_000 });
    await visibleText("7.42");
    await reloadAndSee("7.42");
    if (protectedGrowthImagePath) {
      await page.getByText("有图", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
      const protectedDownloadPromise = page.waitForResponse((response) => response.request().method() === "GET"
        && new URL(response.url()).pathname === protectedGrowthImagePath);
      await page.getByRole("button", { name: "编辑 2026-09-18 生长记录" }).click();
      const editDialog = page.getByRole("dialog", { name: "编辑生长记录" });
      await editDialog.waitFor({ state: "visible", timeout: 15_000 });
      const protectedDownload = await protectedDownloadPromise;
      const savedGrowthImage = editDialog.getByAltText("已保存的生长测量照片，点击查看原图");
      await savedGrowthImage.waitFor({ state: "visible", timeout: 15_000 });
      const savedDimensions = await savedGrowthImage.evaluate((image) => ({
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        src: image.getAttribute("src"),
      }));
      report.growthDiagnostic.imageScenario.firstEditDisplay = {
        status: protectedDownload.status(),
        contentType: protectedDownload.headers()["content-type"] || null,
        cacheControl: protectedDownload.headers()["cache-control"] || null,
        nosniff: protectedDownload.headers()["x-content-type-options"] || null,
        dimensions: savedDimensions,
      };
      const firstEditDisplay = report.growthDiagnostic.imageScenario.firstEditDisplay;
      if (protectedDownload.status() !== 200
        || !firstEditDisplay.contentType?.startsWith("image/png")
        || !firstEditDisplay.cacheControl?.includes("private")
        || !firstEditDisplay.cacheControl?.includes("no-store")
        || firstEditDisplay.nosniff !== "nosniff"
        || !savedDimensions.complete || savedDimensions.naturalWidth < 1 || savedDimensions.naturalHeight < 1
        || new URL(savedDimensions.src, parsed.origin).pathname !== protectedGrowthImagePath) {
        throw new Error(`persisted growth photo did not render through the protected BFF: ${JSON.stringify(firstEditDisplay)}`);
      }
      await shot("05-growth-protected-image-edit");
      const editedWeight = editDialog.getByPlaceholder("例: 7.35");
      await editedWeight.fill("7.43");
      const growthUpdatePromise = page.waitForResponse((response) => response.request().method() === "PATCH"
        && new URL(response.url()).pathname === "/api/growth");
      await editDialog.getByRole("button", { name: "保存修改" }).click();
      const growthUpdate = await growthUpdatePromise;
      const growthUpdatePayload = growthUpdate.request().postDataJSON();
      report.growthDiagnostic.updateStatus = growthUpdate.status();
      report.growthDiagnostic.updatedImageUrl = growthUpdatePayload?.imageUrl || null;
      if (growthUpdate.status() !== 200 || growthUpdatePayload?.imageUrl !== protectedGrowthImagePath) {
        throw new Error(`growth edit did not preserve the protected image: ${growthUpdate.status()} ${JSON.stringify(growthUpdatePayload?.imageUrl)}`);
      }
      await editDialog.waitFor({ state: "detached", timeout: 15_000 });
      await visibleText("7.43");
      await reloadAndSee("7.43");
      await page.getByText("有图", { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
      report.growthDiagnostic.imageScenario.status = "PASS";
    }
    await page.getByRole("button", { name: /删除 2026-09-18 生长记录/ }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(protectedGrowthImagePath ? "7.43" : "7.42", { exact: false }).count()) throw new Error("deleted growth measurement returned after refresh");
    await shot("05-growth-delete-persisted");
  });

  await step("nutrition-route-and-date-switch", async () => {
    await goto("/nutrition", "DRIs 全量营养分析");
    const dateButtons = page.locator("div.flex.gap-2.overflow-x-auto > button");
    if (await dateButtons.count() !== 7) throw new Error("nutrition seven-day selector did not expose exactly seven dates");
    const selectedIndex = await dateButtons.evaluateAll((buttons) => buttons.findIndex((button) => button.className.includes("bg-primary text-white")));
    if (selectedIndex <= 0) throw new Error("nutrition selected date has no preceding historical date button");
    const previousLabel = (await dateButtons.nth(selectedIndex - 1).innerText()).replace(/\s+/g, " ").trim();
    await dateButtons.nth(selectedIndex - 1).click();
    await visibleText("营养摄入");
    if (previousLabel && !(await page.getByText(previousLabel.split(" ").at(-1), { exact: true }).count())) {
      throw new Error(`nutrition did not retain selected historical date ${previousLabel}`);
    }
    await shot("06-nutrition-historical-date");
  });

  await step("supplement-product-and-record-create-refresh-delete", async () => {
    await goto("/nutrition", "DRIs 全量营养分析");
    await page.getByText("配方奶粉与补剂库管理", { exact: true }).click();
    await page.getByText(/补剂与计划 \(/, { exact: false }).click();
    await page.getByRole("button", { name: /自定义/ }).click();
    await page.getByPlaceholder("补剂名称 (如 健敏思液体小蓝盒乳钙)").fill(marks.supplement);
    await page.getByPlaceholder("品牌").fill("test_brand");
    await page.getByPlaceholder("剂型(滴/ml/粒)").fill("滴");
    await page.getByRole("button", { name: "保存并加入计划" }).click();
    await page.getByText(marks.supplement, { exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("div.fixed.inset-0 button").first().click();
    const supplementName = page.getByText(marks.supplement, { exact: true }).first();
    await supplementName.waitFor({ state: "visible", timeout: 15_000 });
    const checkinRow = supplementName.locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]");
    await checkinRow.getByRole("button", { name: "打卡", exact: true }).click();
    await checkinRow.getByText("今日已服", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedSupplement = page.getByText(marks.supplement, { exact: true }).first();
    await persistedSupplement.waitFor({ state: "visible", timeout: 15_000 });
    await persistedSupplement.locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]").getByText("今日已服", { exact: true }).waitFor({ state: "visible" });
    await goto("/", marks.supplement);
    const supplementTimelineButton = page.getByRole("button", { name: /查看可对/ }).filter({ hasText: marks.supplement });
    await supplementTimelineButton.waitFor({ state: "visible", timeout: 15_000 });
    await supplementTimelineButton.click();
    await page.getByRole("dialog", { name: "记录操作" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "删除这条记录" }).click();
    await goto("/nutrition", "DRIs 全量营养分析");
    const resetSupplement = page.getByText(marks.supplement, { exact: true }).first();
    await resetSupplement.locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]").getByRole("button", { name: "打卡", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await page.getByText("配方奶粉与补剂库管理", { exact: true }).click();
    await page.getByText(/补剂与计划 \(/, { exact: false }).click();
    const catalogModal = page.locator("div.fixed.inset-0").filter({ hasText: "配方奶粉与营养补剂库" });
    const productCard = catalogModal.getByText(marks.supplement, { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][.//button[@title='删除补剂']][1]");
    await productCard.getByRole("button", { name: "删除补剂" }).click();
    await page.getByText(marks.supplement, { exact: true }).first().waitFor({ state: "detached", timeout: 15_000 });
    await page.locator("div.fixed.inset-0 button").first().click();
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(marks.supplement, { exact: true }).count()) throw new Error("deleted supplement product returned after refresh");
    await shot("07-supplement-product-record-deleted");
  });

  await step("medical-create-refresh-delete", async () => {
    report.medicalDiagnostic.attempts = [];
    const medicalImageEnabled = runManifest.storage?.s3Covered === true
      && runManifest.storage?.driver === "owned-minio"
      && runManifest.externalAi?.realProviderCovered === false;
    report.medicalDiagnostic.imageScenario = medicalImageEnabled
      ? { status: "RUNNING", storage: runManifest.storage }
      : {
          status: "SKIP",
          reason: "owned run manifest does not prove real MinIO/S3 coverage and virtual external AI isolation",
          storage: runManifest.storage || null,
          externalAi: runManifest.externalAi || null,
        };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const expectedTitle = `${marks.medical}_${attempt}`;
      const diagnostic = { expectedTitle };
      report.medicalDiagnostic.attempts.push(diagnostic);
      await goto("/health/medical/add", "录入化验 / 体检单");
      const medicalTitle = page.getByPlaceholder("如：末梢血常规化验单 / 6月龄体检表");
      await medicalTitle.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const fieldset = document.querySelector("fieldset");
        return fieldset instanceof HTMLFieldSetElement && !fieldset.disabled;
      });
      let protectedImagePath = null;
      if (attempt === 1 && medicalImageEnabled) {
        const imageDiagnostic = report.medicalDiagnostic.imageScenario;
        imageDiagnostic.externalAi = runManifest.externalAi;
        const fixtureBuffer = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        );
        const ocrResponsePromise = page.waitForResponse((response) =>
          response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/medical/ocr");
        await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles({
          name: `e2e_medical_${suffix}.png`,
          mimeType: "image/png",
          buffer: fixtureBuffer,
        });
        const ocrResponse = await ocrResponsePromise;
        const ocrBody = await ocrResponse.json().catch(() => null);
        imageDiagnostic.ocrStatus = ocrResponse.status();
        imageDiagnostic.ocrAttachmentId = ocrBody?.attachmentId || null;
        imageDiagnostic.ocrImageUrl = ocrBody?.imageUrl || null;
        imageDiagnostic.ocrRecognitionQualityCovered = false;
        if (ocrResponse.status() !== 200
          || typeof ocrBody?.attachmentId !== "string"
          || typeof ocrBody?.imageUrl !== "string") {
          throw new Error(`medical OCR did not archive the browser-selected image: ${ocrResponse.status()} ${JSON.stringify(ocrBody)}`);
        }
        protectedImagePath = new URL(ocrBody.imageUrl, parsed.origin).pathname;
        if (protectedImagePath !== `/api/attachments/${ocrBody.attachmentId}`) {
          throw new Error(`medical OCR returned inconsistent protected attachment identity: ${JSON.stringify(ocrBody)}`);
        }
        await page.getByAltText("单据预览").waitFor({ state: "visible", timeout: 15_000 });
        const previewDimensions = await page.getByAltText("单据预览").evaluate((image) => ({
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        }));
        imageDiagnostic.previewDimensions = previewDimensions;
        if (!previewDimensions.complete || previewDimensions.naturalWidth < 1 || previewDimensions.naturalHeight < 1) {
          throw new Error(`medical selected image did not render a valid preview: ${JSON.stringify(previewDimensions)}`);
        }
      }
      // OCR is allowed to prefill fields. Re-enter the test values through the UI
      // after it completes so the persisted report assertions remain deterministic.
      await medicalTitle.fill(expectedTitle);
      await medicalTitle.blur();
      diagnostic.afterTitleBlur = await medicalTitle.inputValue();
      if (diagnostic.afterTitleBlur !== expectedTitle) {
        throw new Error(`medical title ${attempt} was lost immediately after blur: ${JSON.stringify(diagnostic.afterTitleBlur)}`);
      }
      await page.locator('input[type="date"]').fill("2026-09-18");
      await page.getByPlaceholder("如：苏州市儿童医院").fill(`test_验收机构_${attempt}`);
      await page.getByPlaceholder("单据上填写的诊断结论或医嘱建议...").fill(`e2e_仅限隔离测试_${attempt}`);
      diagnostic.afterOtherFields = await medicalTitle.inputValue();
      if (diagnostic.afterOtherFields !== expectedTitle) {
        throw new Error(`medical title ${attempt} was lost after filling later fields: ${JSON.stringify(diagnostic.afterOtherFields)}`);
      }
      let fallbackUploadResponse = null;
      const captureFallbackUpload = (response) => {
        if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/medical/upload") {
          fallbackUploadResponse = response;
        }
      };
      if (protectedImagePath) page.on("response", captureFallbackUpload);
      const medicalPost = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/medical/reports");
      await page.getByRole("button", { name: "确认保存到健康档案" }).click();
      const medicalPayload = (await medicalPost).postDataJSON();
      if (protectedImagePath) page.off("response", captureFallbackUpload);
      diagnostic.postedTitle = medicalPayload?.title;
      diagnostic.postedBabyId = typeof medicalPayload?.babyId === "string" && medicalPayload.babyId.length > 0;
      if (diagnostic.postedTitle !== expectedTitle) {
        throw new Error(`medical POST title ${attempt} differed from the controlled input: ${JSON.stringify(diagnostic.postedTitle)}`);
      }
      if (protectedImagePath) {
        report.medicalDiagnostic.imageScenario.fallbackMedicalUploadObserved = Boolean(fallbackUploadResponse);
        if (fallbackUploadResponse) {
          throw new Error(`medical save unexpectedly uploaded the OCR-archived image a second time: ${fallbackUploadResponse.status()}`);
        }
        if (medicalPayload?.imageUrl !== report.medicalDiagnostic.imageScenario.ocrImageUrl) {
          throw new Error(`medical report did not persist the OCR attachment URL: ${JSON.stringify(medicalPayload?.imageUrl)}`);
        }
      }
      await page.waitForURL(/\/health\/medical/, { timeout: 20_000 });
      await visibleText(expectedTitle);
      await reloadAndSee(expectedTitle);
      const firstProtectedDownload = protectedImagePath
        ? page.waitForResponse((response) => response.request().method() === "GET"
          && new URL(response.url()).pathname === protectedImagePath)
        : null;
      await page.getByText(expectedTitle, { exact: false }).first().click();
      if (firstProtectedDownload && protectedImagePath) {
        const response = await firstProtectedDownload;
        const image = page.getByAltText(expectedTitle, { exact: true });
        await image.waitFor({ state: "visible", timeout: 15_000 });
        const dimensions = await image.evaluate((element) => ({
          complete: element.complete,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          src: element.getAttribute("src"),
        }));
        const imageDiagnostic = report.medicalDiagnostic.imageScenario;
        imageDiagnostic.firstDownload = {
          status: response.status(),
          contentType: response.headers()["content-type"] || null,
          cacheControl: response.headers()["cache-control"] || null,
          nosniff: response.headers()["x-content-type-options"] || null,
          dimensions,
        };
        if (response.status() !== 200
          || !imageDiagnostic.firstDownload.contentType?.startsWith("image/png")
          || !imageDiagnostic.firstDownload.cacheControl?.includes("private")
          || !imageDiagnostic.firstDownload.cacheControl?.includes("no-store")
          || imageDiagnostic.firstDownload.nosniff !== "nosniff"
          || !dimensions.complete || dimensions.naturalWidth < 1 || dimensions.naturalHeight < 1) {
          throw new Error(`protected medical image first display failed: ${JSON.stringify(imageDiagnostic.firstDownload)}`);
        }
        await shot("07-medical-protected-image-first-display");
        await page.getByRole("button", { name: "完成", exact: true }).click();
        const refreshedDownload = page.waitForResponse((nextResponse) => nextResponse.request().method() === "GET"
          && new URL(nextResponse.url()).pathname === protectedImagePath);
        await page.reload({ waitUntil: "domcontentloaded" });
        await visibleText(expectedTitle);
        await page.getByText(expectedTitle, { exact: false }).first().click();
        const refreshedResponse = await refreshedDownload;
        const refreshedImage = page.getByAltText(expectedTitle, { exact: true });
        await refreshedImage.waitFor({ state: "visible", timeout: 15_000 });
        const refreshedDimensions = await refreshedImage.evaluate((element) => ({
          complete: element.complete,
          naturalWidth: element.naturalWidth,
          naturalHeight: element.naturalHeight,
          src: element.getAttribute("src"),
        }));
        imageDiagnostic.refreshedDownload = { status: refreshedResponse.status(), dimensions: refreshedDimensions };
        if (refreshedResponse.status() !== 200
          || !refreshedDimensions.complete || refreshedDimensions.naturalWidth < 1 || refreshedDimensions.naturalHeight < 1
          || refreshedDimensions.src !== dimensions.src) {
          throw new Error(`protected medical image did not survive refresh: ${JSON.stringify(imageDiagnostic.refreshedDownload)}`);
        }
        const anonymousContext = await browser.newContext({ baseURL: parsed.origin });
        try {
          const anonymousResponse = await anonymousContext.request.get(protectedImagePath);
          imageDiagnostic.anonymousStatus = anonymousResponse.status();
          if (![401, 403].includes(anonymousResponse.status())) {
            throw new Error(`protected medical image was readable without a session: ${anonymousResponse.status()}`);
          }
        } finally {
          await anonymousContext.close();
        }
        imageDiagnostic.status = "PASS";
        await shot("07-medical-protected-image-refreshed");
      }
      await page.getByRole("button", { name: /删除报告/ }).click();
      await page.reload({ waitUntil: "domcontentloaded" });
      if (await page.getByText(expectedTitle, { exact: false }).count()) throw new Error(`deleted medical report ${attempt} returned after refresh`);
    }
    await shot("07-medical-delete-persisted");
  });

  await step("vaccine-completion-refresh-persistence", async () => {
    await goto("/health/vaccines", "疫苗接种规划");
    await page.getByText("全部规划", { exact: true }).click();
    const markButton = page.getByRole("button", { name: "点击标记此针已接种" }).first();
    await markButton.waitFor({ state: "visible", timeout: 15_000 });
    const vaccineCard = markButton.locator("xpath=ancestor::div[contains(@class,'flex items-center gap-3')][1]");
    const vaccineName = (await vaccineCard.locator("p.text-sm.font-bold").innerText()).trim();
    if (!vaccineName) throw new Error("could not identify vaccine selected for persistence check");
    await markButton.click();
    const completedCard = page.getByText(vaccineName, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'flex items-center gap-3')][1]");
    await completedCard.getByRole("button", { name: "点击撤销已接种状态" }).waitFor({ state: "visible", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("全部规划", { exact: true }).click();
    const persistedCard = page.getByText(vaccineName, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'flex items-center gap-3')][1]");
    const undoButton = persistedCard.getByRole("button", { name: "点击撤销已接种状态" });
    await undoButton.waitFor({ state: "visible", timeout: 15_000 });
    await shot("08-vaccine-completed-persisted");
    await undoButton.click();
    await persistedCard.getByRole("button", { name: "点击标记此针已接种" }).waitFor({ state: "visible", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("全部规划", { exact: true }).click();
    const cleanedCard = page.getByText(vaccineName, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'flex items-center gap-3')][1]");
    await cleanedCard.getByRole("button", { name: "点击标记此针已接种" }).waitFor({ state: "visible", timeout: 15_000 });
  });

  await step("feeding-delete-final", async () => {
    await goto("/", marks.feedingEdited);
    await clickRecord(marks.feedingEdited);
    await page.getByRole("button", { name: "删除这条记录" }).click();
    await page.getByText(marks.feedingEdited, { exact: false }).first().waitFor({ state: "detached", timeout: 15_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (await page.getByText(marks.feedingEdited, { exact: false }).count()) throw new Error("deleted feeding returned after refresh");
  });

  await step("family-switch-ui", async () => {
    await goto("/family", "家庭成员与共享");
    if (!secondFamilyInvite) throw new Error("second isolated family fixture was not created");
    await page.getByPlaceholder("输入其他家庭的 6 位邀请码").fill(secondFamilyInvite);
    await page.getByRole("button", { name: "加入", exact: true }).click();
    await visibleText(fixture.displayName);

    ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: parsed.origin });
    const ownerPage = await ownerContext.newPage();
    ownerPage.on("console", (msg) => {
      if (["error", "warning"].includes(msg.type())) report.console.push({ type: msg.type(), text: msg.text(), url: ownerPage.url(), actor: "second-family-owner" });
    });
    ownerPage.on("pageerror", (error) => report.console.push({ type: "pageerror", text: error.message, url: ownerPage.url(), actor: "second-family-owner" }));
    ownerPage.on("requestfailed", (request) => report.network.push({ method: request.method(), url: request.url(), error: request.failure()?.errorText, actor: "second-family-owner" }));
    ownerPage.on("response", (response) => {
      if (response.status() >= 400) report.network.push({ method: response.request().method(), url: response.url(), status: response.status(), actor: "second-family-owner" });
    });
    await ownerPage.goto("/login", { waitUntil: "domcontentloaded" });
    await ownerPage.getByPlaceholder("请输入用户名").fill(fixture.username);
    await ownerPage.getByPlaceholder("请输入密码").fill(fixture.password);
    await ownerPage.getByRole("button", { name: "登 录" }).click();
    await ownerPage.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await ownerPage.goto("/family", { waitUntil: "domcontentloaded" });
    await ownerPage.getByText("宝宝访问权限", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    const grantRow = ownerPage.getByText(account.displayName, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]");
    await grantRow.getByRole("button", { name: "授权访问" }).click();
    const authorizedRow = ownerPage.getByText(account.displayName, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]");
    await authorizedRow.getByRole("button", { name: "撤回访问" }).waitFor({ state: "visible", timeout: 15_000 });

    await authorizedRow.getByRole("button", { name: "撤回访问" }).click();
    await ownerPage.getByText(account.displayName, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]").getByRole("button", { name: "授权访问" }).waitFor({ state: "visible", timeout: 15_000 });
    const mainLogin = await isolatedApi("/api/v1/auth/login", {
      method: "POST",
      body: { username: account.username, password: account.password },
    });
    if (!mainLogin?.accessToken) throw new Error("main test account login did not return an access token for revoke verification");
    const denied = await page.request.get(`${apiURL.origin}/api/v1/babies/${encodeURIComponent(secondBabyId)}`, {
      headers: { authorization: `Bearer ${mainLogin.accessToken}`, accept: "application/json" },
    });
    if (![403, 404].includes(denied.status())) {
      throw new Error(`revoked main user could still read second baby: GET returned ${denied.status()}`);
    }

    const regrantRow = ownerPage.getByText(account.displayName, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]");
    await regrantRow.getByRole("button", { name: "授权访问" }).click();
    await ownerPage.getByText(account.displayName, { exact: true }).last().locator("xpath=ancestor::div[contains(@class,'flex items-center justify-between')][1]").getByRole("button", { name: "撤回访问" }).waitFor({ state: "visible", timeout: 15_000 });
    await ownerContext.close();
    ownerContext = undefined;

    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleText(fixture.baby);
    const originalBaby = page.getByRole("button").filter({ hasText: account.baby }).first();
    const targetBaby = page.getByRole("button").filter({ hasText: fixture.baby }).first();
    await targetBaby.click();
    await waitSelected(targetBaby, fixture.baby);
    await originalBaby.click();
    await waitSelected(originalBaby, account.baby);
    await targetBaby.click();
    await waitSelected(targetBaby, fixture.baby);
    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleText(fixture.baby);
    const persistedTarget = page.getByRole("button").filter({ hasText: fixture.baby }).first();
    await waitSelected(persistedTarget, fixture.baby);
    await shot("08-family-switch-persisted");
  });

  await step("network-and-console-health", async () => {
    const failedResponses = report.network.filter((item) =>
      (Number(item.status) >= 400 || item.error)
      && item.expected !== "offline-submit"
      && item.expected !== "offline-read-503");
    const consoleErrors = report.console.filter((item) => {
      if (item.type !== "error" && item.type !== "pageerror") return false;
      if (item.expectedCandidate === "offline-read-503") {
        const evidenced = report.network.some((networkItem) => networkItem.expected === "offline-read-503"
          && (item.relatedUrl ? networkItem.url === item.relatedUrl : new URL(networkItem.url).pathname === item.relatedPath));
        if (evidenced) {
          item.expected = "offline-read-503";
          return false;
        }
      }
      if (item.expectedCandidate === "offline-submit") {
        const locationPath = item.locationUrl ? new URL(item.locationUrl).pathname : null;
        const evidenced = locationPath === "/api/records/feeding" && report.network.some((networkItem) =>
          networkItem.expected === "offline-submit"
          && networkItem.method === "POST"
          && new URL(networkItem.url).pathname === locationPath
          && networkItem.error?.includes("ERR_INTERNET_DISCONNECTED"));
        if (evidenced) {
          item.expected = "offline-submit";
          return false;
        }
      }
      return true;
    });
    if (failedResponses.length || consoleErrors.length) {
      throw new Error(`${failedResponses.length} HTTP failures and ${consoleErrors.length} console/page errors were observed; see report details`);
    }
  });
} finally {
  report.finishedAt = new Date().toISOString();
  report.result = report.steps.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
  await writeFile(path.join(evidenceDir, `${stamp}-ui-parity-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  if (ownerContext) await ownerContext.close().catch(() => {});
  await browser.close();
}

const failed = report.steps.filter((item) => item.status === "FAIL");
for (const item of report.steps) console.log(`${item.status.padEnd(4)} ${item.name}${item.error ? `: ${item.error}` : ""}`);
console.log(`Evidence: ${evidenceDir}`);
if (failed.length) process.exitCode = 1;

#!/usr/bin/env node
/** Real Chromium UI acceptance against the held, isolated runner via SSH -L. */
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

function arg(name, required = false) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`missing ${name}`);
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
  return value;
}

function loopback(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", "browser tunnel must use HTTP loopback");
  assert.equal(url.hostname, "127.0.0.1", "browser tunnel must bind to 127.0.0.1");
  assert.ok(url.port, "browser tunnel must use an explicit port");
  assert.ok(![3080, 3081, 3088, 3089, 5432, 6379].includes(Number(url.port)), "reserved port rejected");
  assert.equal(url.pathname, "/", "base URL cannot include a path");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  return url.origin;
}

function pass(report, name) {
  report.checks.push(name);
  process.stdout.write(`${JSON.stringify({ check: name, status: "PASS" })}\n`);
}

async function visible(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 90_000 }).catch(() => {
    throw new Error(`ui_element_not_visible:${label}`);
  });
}

async function expectHomeResponse(page, days) {
  const waiter = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/records/trends" && url.searchParams.get("days") === String(days);
  }, { timeout: 30_000 });
  const button = page.getByRole("button", { name: `近 ${days} 天`, exact: true });
  const pressed = await button.getAttribute("aria-pressed");
  if (pressed !== "true") await button.click();
  const response = await waiter;
  assert.equal(response.status(), 200, `home trends ${days}d HTTP`);
  const payload = await response.json();
  assert.equal(payload.days?.length, days, `home trends ${days}d series length`);
  assert.ok(payload.days.every(day => Number.isInteger(day.foodCount)), "every care day includes foodCount");
  assert.ok(payload.days.some(day => day.recordedMilkMl > 0), "real milk data is plotted");
  return payload;
}

async function expectNutritionResponse(page, days) {
  const waiter = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/nutrition/analysis" && url.searchParams.get("days") === String(days);
  }, { timeout: 30_000 });
  const tab = page.getByRole("tab", { name: new RegExp(`近\\s*${days}\\s*天趋势`) });
  await tab.click();
  const response = await waiter;
  assert.equal(response.status(), 200, `nutrition trends ${days}d HTTP`);
  const payload = await response.json();
  const expectedNutrients = [
    "energy_kcal", "energy_kj", "protein", "fat", "carbohydrate", "dietary_fiber",
    "linoleic_acid", "alpha_linolenic_acid", "dha", "ara", "vitamin_a", "vitamin_d",
    "vitamin_e", "vitamin_k", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12",
    "vitamin_c", "folate", "niacin", "pantothenic_acid", "biotin", "choline", "calcium",
    "phosphorus", "potassium", "sodium", "magnesium", "iron", "zinc", "copper",
    "manganese", "iodine", "selenium", "taurine", "nucleotides", "lutein",
  ];
  const summary = payload.summary;
  assert.equal(summary?.dailyTrends?.length, days, `nutrition trends ${days}d series length`);
  assert.deepEqual(Object.keys(summary.averageIntakes).sort(), [...expectedNutrients].sort(), "complete metric options");
  for (const day of summary.dailyTrends) {
    assert.deepEqual(Object.keys(day.nutrients ?? {}).sort(), [...expectedNutrients].sort(), "complete daily nutrient map");
  }
  assert.ok(summary.dailyTrends.some(day => day.totalFeedingMl > 0), "real feeding data is included");
  assert.ok(summary.dailyTrends.some(day => day.nutrients.vitamin_d > 0), "real supplement data is included");
  return summary;
}

async function main() {
  const fixturePath = arg("--fixture", true);
  const baseUrl = loopback(arg("--base-url", true));
  const reportPath = arg("--report");
  const screenshotDir = arg("--screenshot-dir");
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const fixtureStat = await stat(fixturePath);
  if ((fixtureStat.mode & 0o077) !== 0) throw new Error("browser_fixture_permissions_must_be_0600_or_stricter");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(fixture.testTenant, true, "fixture must be explicitly marked disposable test tenant");
  assert.match(fixture.username, /^test_/);
  assert.match(fixture.familyName, /^test_family_/);
  assert.match(fixture.babyName, /^test_baby_/);
  assert.equal(Number(new URL(fixture.baseUrl).port), Number(fixture.webPort));
  assert.equal(Number(new URL(baseUrl).port), Number(fixture.webPort), "SSH tunnel must preserve the runner port");

  const report = {
    scope: "Chromium UI acceptance over local SSH tunnel",
    status: "RUNNING",
    webPort: Number(fixture.webPort),
    checks: [],
    injectedFailures: [],
  };
  let browser;
  let activePage;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 430, height: 1000 }, locale: "zh-CN", serviceWorkers: "block" });
    const loginResponse = await context.request.post(`${baseUrl}/api/auth/login`, {
      headers: { origin: baseUrl, "content-type": "application/json" },
      data: { username: fixture.username, password: fixture.password },
      timeout: 30_000,
    });
    assert.equal(loginResponse.status(), 200, "real BFF login");
    const loginBody = await loginResponse.json();
    assert.ok(!("accessToken" in loginBody) && !("refreshToken" in loginBody), "BFF must not expose bearer tokens");

    let meResponse = await context.request.get(`${baseUrl}/api/auth/me`, { timeout: 20_000 });
    if (meResponse.status() !== 200 || !(await meResponse.json()).user) {
      const cookies = await loginResponse.headersArray();
      const setCookie = cookies.find(item => item.name.toLowerCase() === "set-cookie")?.value;
      const cookiePair = setCookie?.split(";", 1)[0];
      const equals = cookiePair?.indexOf("=") ?? -1;
      assert.ok(equals > 0, "login must issue a session cookie");
      await context.addCookies([{
        name: cookiePair.slice(0, equals), value: cookiePair.slice(equals + 1), domain: "127.0.0.1",
        path: "/", secure: true, httpOnly: true, sameSite: "Lax",
      }]);
      const probe = await context.newPage();
      await probe.goto(baseUrl, { waitUntil: "domcontentloaded" });
      const identity = await probe.evaluate(async () => {
        const response = await fetch("/api/auth/me");
        return { status: response.status, payload: await response.json() };
      });
      await probe.close();
      assert.equal(identity.status, 200, "Chromium loopback session status");
      assert.ok(identity.payload.user, "Chromium must send the real protected BFF cookie");
      meResponse = { status: () => identity.status, json: async () => identity.payload };
    }
    assert.equal(meResponse.status(), 200, "browser context must carry the BFF session");
    assert.ok((await meResponse.json()).user, "authenticated identity must be loaded through BFF");
    pass(report, "real test_ account login and protected BFF session in Chromium");

    const page = await context.newPage();
    activePage = page;
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.name));
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const nutritionEntry = page.getByRole("link", { name: /全量营养/ }).first();
    await visible(nutritionEntry, "homepage nutrition entry");
    assert.equal(await nutritionEntry.getAttribute("href"), "/nutrition");
    pass(report, "homepage exposes a working 全量营养 entry");

    const careToggle = page.getByRole("button", { name: /^照护趋势/ });
    await visible(careToggle, "homepage care trend entry");
    await careToggle.click();
    const homePanel = page.locator("#home-daily-trends");
    await visible(homePanel, "homepage trend panel");
    await visible(page.getByRole("heading", { name: /近 7 天记录奶量趋势/ }), "default milk trend");
    pass(report, "homepage opens a real 7-day milk trend");

    const homeSeries = await expectHomeResponse(page, 30);
    assert.ok(homeSeries.days.filter(day => day.recordedMilkMl != null).length >= 3);
    await expectHomeResponse(page, 7);
    pass(report, "homepage trend switches between real 7-day and 30-day data");
    assert.equal(await page.getByText(/signal is aborted|without reason/).count(), 0,
      "intentionally cancelled trend requests must not show an error toast");
    pass(report, "trend window changes do not show cancellation error toasts");

    const homeMetrics = [
      ["奶量", "记录奶量"], ["睡眠", "睡眠"], ["尿布", "尿布"], ["辅食", "辅食"],
    ];
    for (const [card, chart] of homeMetrics) {
      const stat = page.getByRole("button", { name: new RegExp(`查看${card}趋势`) });
      await visible(stat, `homepage ${card} stat card`);
      await stat.click();
      await visible(page.getByRole("heading", { name: new RegExp(`近 7 天${chart}趋势`) }), `${card} card trend`);
      const selected = page.getByRole("group", { name: "趋势指标" }).getByRole("button", { name: chart, exact: true });
      assert.equal(await selected.getAttribute("aria-pressed"), "true", `${card} card selects its trend`);
    }
    pass(report, "all four homepage stat cards open their matching trend");
    if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, "home-mobile.png"), fullPage: true });

    let injected = false;
    await page.route("**/api/nutrition/analysis**", async route => {
      if (!injected) {
        injected = true;
        report.injectedFailures.push({ route: "/api/nutrition/analysis", status: 503, purpose: "UI retry control only" });
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "test-only injected outage" }) });
      } else {
        await route.continue();
      }
    });
    await nutritionEntry.click();
    await page.waitForURL(url => url.pathname === "/nutrition", { timeout: 30_000 });
    const nutritionError = page.locator("p[role=alert]");
    await visible(nutritionError, "injected nutrition error state");
    report.nutritionAlert = await nutritionError.allTextContents();
    assert.equal(injected, true, "one UI-only failure must be injected");
    await page.unroute("**/api/nutrition/analysis**");
    await page.getByRole("button", { name: "重新加载营养数据", exact: true }).click();
    await visible(page.getByRole("button", { name: "查看维生素D趋势", exact: true }), "nutrition retry loads core cards");
    pass(report, "nutrition API error is visible and retry recovers on actual backend data");

    const summary7 = await expectNutritionResponse(page, 7);
    const chart = page.getByRole("heading", { name: "总奶量趋势", exact: true });
    await visible(chart, "7-day nutrition trend chart");
    assert.ok(summary7.dailyTrends.some(day => day.hasRecords === false), "fixture includes an entirely unrecorded day");
    const detailPanel = page.locator("details").filter({ hasText: "查看逐日明细" }).first();
    await detailPanel.locator("summary").click();
    const blankMilkCells = detailPanel.locator("tbody tr td:nth-child(2)").filter({ hasText: "—" });
    assert.ok(await blankMilkCells.count() >= 1, "unrecorded milk day is displayed as a gap, not numeric zero");
    pass(report, "no-record nutrition days remain blank in the visible daily detail");

    const coreMetrics = [
      ["维生素D", "vitamin_d"], ["钙", "calcium"], ["铁", "iron"],
      ["维生素A", "vitamin_a"], ["锌", "zinc"], ["DHA", "dha"],
    ];
    for (const [name, metric] of coreMetrics) {
      await page.getByRole("button", { name: `查看${name}趋势`, exact: true }).click();
      await visible(page.getByRole("heading", { name: `${name}趋势`, exact: true }), `${name} trend selection`);
      assert.equal(await page.getByRole("combobox", { name: "选择营养趋势指标" }).inputValue(), metric);
    }
    pass(report, "each of six core nutrient cards selects its own daily trend");

    const selector = page.getByRole("combobox", { name: "选择营养趋势指标" });
    const optionValues = await selector.locator("option").evaluateAll(options => options.map(option => option.value));
    assert.equal(optionValues.length, 39, "milk plus every one of 38 nutrition metrics is selectable");
    assert.ok(optionValues.includes("energy_kj") && optionValues.includes("lutein"));
    await selector.selectOption("energy_kj");
    await visible(page.getByRole("heading", { name: /能量\(千焦\)趋势|能量（千焦）趋势/ }), "full metric dropdown selection");
    pass(report, "full nutrient dropdown includes and renders non-core metrics");

    await page.getByRole("button", { name: "总奶量", exact: true }).click();
    const summary30 = await expectNutritionResponse(page, 30);
    await visible(page.getByRole("heading", { name: "总奶量趋势", exact: true }), "30-day nutrition chart");
    assert.equal(summary7.dailyTrends.length, 7);
    assert.equal(summary30.dailyTrends.length, 30);
    pass(report, "nutrition analysis and chart switch between complete 7-day and 30-day data");
    if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, "nutrition-mobile.png"), fullPage: true });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const desktopEntry = page.getByRole("link", { name: /全量营养/ }).first();
    await visible(desktopEntry, "desktop homepage nutrition entry");
    await page.getByRole("button", { name: /^照护趋势/ }).click();
    await visible(page.getByRole("heading", { name: /近 7 天记录奶量趋势/ }), "desktop homepage milk trend");
    await expectHomeResponse(page, 30);
    pass(report, "desktop homepage entry and 7/30-day trend layout works");
    if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, "home-desktop.png"), fullPage: true });

    if (pageErrors.length) throw new Error(`unexpected_page_runtime_errors:${pageErrors.join(",")}`);
    report.status = "PASS_BROWSER";
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks, webPort: report.webPort })}\n`);
    await context.close();
    return 0;
  } catch (error) {
    report.status = "FAIL";
    report.failure = error instanceof Error ? error.message : error.name;
    if (activePage) {
      report.visibleAlerts = await activePage.getByRole("alert").allTextContents();
      if (screenshotDir) await activePage.screenshot({ path: resolve(screenshotDir, "failure.png"), fullPage: true });
    }
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stderr.write(`${JSON.stringify({ status: report.status, failure: report.failure, webPort: report.webPort })}\n`);
    return 1;
  } finally {
    if (browser) await browser.close();
  }
}

process.exitCode = await main();

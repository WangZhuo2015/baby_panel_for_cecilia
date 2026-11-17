import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repo, "package.json"));
const esbuild = require("esbuild");
const postcss = require("postcss");
const tailwindPostcss = require("@tailwindcss/postcss");
const { chromium } = require("playwright");

const virtualModules = new Map([
  ["next/link", `export default function Link({ href, prefetch, ...props }) { return <a href={href} {...props} />; }`],
  ["next/navigation", `export function usePathname() { return window.location.pathname; } export function useRouter() { return { push(path) { window.location.href = path; } }; }`],
  // This virtual store keeps the harness independent from accounts and databases.
  ["@/stores/useBabyStore", `export function useBabyStore(selector) { return selector({ baby: null }); }`],
  ["@/lib/age", `export function calculateAge() { return { label: '0月0天' }; }`],
  ["@/lib/quickai-bus", `export function openQuickAI() {}`],
  ["@/lib/drawer-bus", `export function openRecordDrawer() {}`],
  ["@/components/ui/ThemeToggle", `export function ThemeToggle() { return <button type="button">主题</button>; }`],
  ["@/components/ui/BabyAvatar", `export function BabyAvatar() { return null; }`],
  ["@/components/ui/FeatureTourModal", `export function FeatureTourModal() { return null; }`],
  ["@/components/user/PersonalTokenModal", `export function PersonalTokenModal() { return null; }`],
  ["@/components/mcp/AiUsageModal", `export function AiUsageModal() { return null; }`],
]);

const navigationStubPlugin = {
  name: "isolated-navigation-test-stubs",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) =>
      virtualModules.has(args.path)
        ? { path: args.path, namespace: "navigation-test-stub" }
        : null,
    );
    build.onLoad({ filter: /.*/, namespace: "navigation-test-stub" }, (args) => ({
      contents: virtualModules.get(args.path),
      loader: "tsx",
      resolveDir: repo,
    }));
  },
};

function findChromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (configured && fs.existsSync(configured)) return configured;

  const playwrightPath = chromium.executablePath();
  if (fs.existsSync(playwrightPath)) return playwrightPath;

  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH)
    : path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(browserRoot)) {
    const revisions = fs.readdirSync(browserRoot).sort().reverse();
    for (const revision of revisions) {
      for (const candidate of [
        path.join(browserRoot, revision, "chrome-linux-arm64", "chrome"),
        path.join(browserRoot, revision, "chrome-linux", "chrome"),
        path.join(browserRoot, revision, "chrome-linux64", "chrome"),
        path.join(browserRoot, revision, "chrome-headless-shell-linux-arm64", "chrome-headless-shell"),
        path.join(browserRoot, revision, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      ]) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error(
    "No Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or install it with `npx playwright install chromium`.",
  );
}

test("desktop and mobile navigation expose a direct, active Settings link", async () => {
  const entry = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { BottomNav } from ${JSON.stringify(path.join(repo, "components/navigation/BottomNav.tsx"))};
    import { DesktopSidebar } from ${JSON.stringify(path.join(repo, "components/navigation/DesktopSidebar.tsx"))};
    createRoot(document.getElementById("root")).render(<><DesktopSidebar /><BottomNav /></>);
  `;
  const built = await esbuild.build({
    absWorkingDir: repo,
    stdin: {
      contents: entry,
      resolveDir: repo,
      sourcefile: "settings-navigation-entry.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    nodePaths: [path.join(repo, "node_modules")],
    jsx: "automatic",
    plugins: [navigationStubPlugin],
    logLevel: "silent",
  });
  const appJs = built.outputFiles[0].text;
  const globalsPath = path.join(repo, "app/globals.css");
  const cssResult = await postcss([tailwindPostcss()]).process(
    fs.readFileSync(globalsPath, "utf8"),
    { from: globalsPath },
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${cssResult.css}</style></head><body><div id="root"></div><script>${appJs}</script></body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const screenshotDir = process.env.SETTINGS_NAV_SCREENSHOT_DIR
    ? path.resolve(process.env.SETTINGS_NAV_SCREENSHOT_DIR)
    : path.join(os.tmpdir(), "settings-navigation-screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: findChromiumExecutable(),
    });

    const scenarios = [
      { width: 320, height: 740, kind: "mobile" },
      { width: 390, height: 844, kind: "mobile" },
      { width: 1280, height: 900, kind: "desktop" },
    ];

    for (const scenario of scenarios) {
      const page = await browser.newPage({
        viewport: { width: scenario.width, height: scenario.height },
      });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));

      try {
        await page.goto(`${baseUrl}/settings`, { waitUntil: "load" });
        const visibleNav = page.locator('nav[aria-label="主导航"]:visible');
        assert.equal(await visibleNav.count(), 1, `${scenario.width}px has one visible primary nav`);

        const settingsLink = visibleNav.locator('a[href="/settings"]');
        assert.equal(await settingsLink.count(), 1, `${scenario.width}px has a direct Settings link`);
        assert.equal(await settingsLink.getAttribute("aria-current"), "page");
        assert.equal((await settingsLink.innerText()).trim(), "设置");

        const geometry = await page.evaluate(() => {
          const nav = [...document.querySelectorAll('nav[aria-label="主导航"]')]
            .find((element) => element.getClientRects().length > 0);
          const navRect = nav.getBoundingClientRect();
          const links = [...nav.querySelectorAll("a")].map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              href: element.getAttribute("href"),
              text: element.innerText.trim(),
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              right: rect.right,
              bottom: rect.bottom,
            };
          });
          const ai = nav.querySelector('button[aria-label^="打开 AI"]');
          const aiRect = ai?.getBoundingClientRect();
          const style = getComputedStyle(nav);
          return {
            nav: {
              x: navRect.x,
              y: navRect.y,
              width: navRect.width,
              height: navRect.height,
              right: navRect.right,
              bottom: navRect.bottom,
              paddingBottom: parseFloat(style.paddingBottom),
            },
            links,
            ai: aiRect
              ? {
                  x: aiRect.x,
                  y: aiRect.y,
                  width: aiRect.width,
                  height: aiRect.height,
                  right: aiRect.right,
                  bottom: aiRect.bottom,
                }
              : null,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });

        assert.ok(
          geometry.scrollWidth <= scenario.width,
          `${scenario.width}px has no horizontal document overflow (${geometry.scrollWidth}px)`,
        );
        assert.ok(geometry.nav.x >= 0 && geometry.nav.right <= scenario.width + 0.5);

        if (scenario.kind === "mobile") {
          assert.ok(geometry.nav.bottom >= scenario.height - 0.5);
          assert.ok(geometry.nav.paddingBottom >= 8, "bottom safe-area padding is retained");
          assert.deepEqual(
            geometry.links.map((link) => link.href),
            ["/", "/growth", "/food", "/health/vaccines", "/settings"],
            "all existing route entries remain and Settings is added",
          );
          for (const link of geometry.links) {
            assert.ok(link.width >= 44 && link.height >= 44, `${link.href} is at least 44px: ${JSON.stringify(link)}`);
            assert.ok(link.x >= geometry.nav.x - 0.5 && link.right <= geometry.nav.right + 0.5);
          }
          assert.ok(geometry.ai, "the AI shortcut remains visible");
          assert.equal(geometry.ai.width, 44);
          assert.equal(geometry.ai.height, 44);
          for (const link of geometry.links) {
            const overlapX = Math.max(0, Math.min(link.right, geometry.ai.right) - Math.max(link.x, geometry.ai.x));
            const overlapY = Math.max(0, Math.min(link.bottom, geometry.ai.bottom) - Math.max(link.y, geometry.ai.y));
            assert.ok(!(overlapX > 0.5 && overlapY > 0.5), `AI shortcut does not overlap ${link.href}`);
          }
        } else {
          assert.ok(
            geometry.links.find((link) => link.href === "/settings")?.height >= 44,
            "desktop Settings entry meets the 44px target height",
          );
          assert.ok(geometry.links.length >= 10, "desktop main navigation remains visible");
        }

        await page.goto(`${baseUrl}/`, { waitUntil: "load" });
        const homeSettings = page.locator('nav[aria-label="主导航"]:visible a[href="/settings"]');
        await homeSettings.click();
        await page.waitForURL(`${baseUrl}/settings`);
        const clickedSettings = page.locator('nav[aria-label="主导航"]:visible a[href="/settings"]');
        assert.equal(await clickedSettings.getAttribute("aria-current"), "page", "clicking Settings activates its destination");

        await page.goto(`${baseUrl}/settings/llm`, { waitUntil: "load" });
        const nestedSettings = page.locator('nav[aria-label="主导航"]:visible a[href="/settings"]');
        assert.equal(await nestedSettings.getAttribute("aria-current"), "page", "nested settings routes remain highlighted");
        assert.deepEqual(pageErrors, [], "browser console has no uncaught page errors");

        const screenshotPath = path.join(screenshotDir, `settings-navigation-${scenario.width}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(
          `PASS ${scenario.width}x${scenario.height} ${scenario.kind}: /settings active, ` +
          `${geometry.links.length} links, scrollWidth=${geometry.scrollWidth}; screenshot=${screenshotPath}`,
        );
      } finally {
        await page.close();
      }
    }

    console.log("PASS: isolated component harness used a virtual store and did not load .env or connect to app/database services");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: development page should use AbortController to avoid race (P1-4 red->green)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/(main)/development/page.tsx"), "utf-8");
  assert.ok(content.includes("AbortController"), "development page should use AbortController");
  assert.ok(content.includes("signal"), "should pass signal to fetch");
  assert.ok(content.includes("abort()"), "should cleanup with abort on unmount");
});

test("TDD: SleepRecordPage should not define LiveSleepDuration inside render (P1-4 red->green)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/records/sleep/page.tsx"), "utf-8");
  // Check that LiveSleepDuration is defined at module top-level, not inside SleepRecordPage
  const lines = content.split("\n");
  const liveIdx = lines.findIndex((l) => l.includes("function LiveSleepDuration"));
  const pageIdx = lines.findIndex((l) => l.includes("export default function SleepRecordPage"));
  assert.ok(liveIdx !== -1, "LiveSleepDuration should exist");
  assert.ok(pageIdx !== -1, "SleepRecordPage should exist");
  assert.ok(liveIdx < pageIdx || liveIdx > pageIdx + 200, "LiveSleepDuration should be outside SleepRecordPage (top-level)");
  // More strict: ensure not indented inside page function (check not inside export default)
  // If LiveSleepDuration is inside, pageIdx < liveIdx < next export end
  if (liveIdx > pageIdx) {
    // If defined after pageIdx, ensure it's at column 0 (not indented)
    const line = lines[liveIdx];
    assert.ok(!line.startsWith("  ") && !line.startsWith("\t"), "LiveSleepDuration should be at module level, not indented inside page");
  }
});

test("TDD: feeding stopwatchStore should not be module singleton with listeners leak (P1-4)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/records/feeding/page.tsx"), "utf-8");
  // After fix, stopwatch should use useRef/useState inside component, not module-level const stopwatchStore = { listeners: Set }
  // Before fix, this pattern exists - we want to ensure it's removed
  const hasModuleSingleton = content.includes("const stopwatchStore = {") && content.includes("listeners");
  assert.equal(hasModuleSingleton, false, "stopwatchStore module singleton should be removed (use useRef/state instead)");
});

test("TDD: CuteButton should extend ButtonHTMLAttributes (P1-4)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "components/ui/CuteButton.tsx"), "utf-8");
  assert.ok(content.includes("ButtonHTMLAttributes"), "CuteButton should extend ButtonHTMLAttributes");
});

test("PWA Long-tail: AppHeader should have fallback routing to prevent standalone back trap", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "components/ui/AppHeader.tsx"), "utf-8");
  assert.ok(content.includes("router.push('/')") || content.includes('router.push("/")'), "AppHeader must have router fallback");
  assert.ok(content.includes("useRouter"), "AppHeader must use Next.js useRouter");
});

test("PWA Long-tail: NursingDualTimer should prevent drift with timestamp delta and persist to localStorage", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "components/records/NursingDualTimer.tsx"), "utf-8");
  assert.ok(content.includes("baby_active_nursing_timer"), "NursingDualTimer must persist to localStorage");
  assert.ok(content.includes("startAt"), "NursingDualTimer must track real start timestamp");
  assert.ok(content.includes("visibilitychange"), "NursingDualTimer must listen to visibilitychange for instant sync");
});

test("PWA Long-tail: manifest.json should allow any orientation for iPad/Desktop workbench", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/manifest.json"), "utf-8"));
  assert.equal(manifest.orientation, "any", "manifest orientation should be 'any' to support iPad landscape");
});

test("PWA Long-tail: offline.html should auto-reconnect on online event", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "public/offline.html"), "utf-8");
  assert.ok(content.includes("addEventListener('online'") || content.includes('addEventListener("online"'), "offline.html must listen to online event");
});

test("PWA Long-tail: InstallGuideBanner should listen to appinstalled event", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "components/ui/InstallGuideBanner.tsx"), "utf-8");
  assert.ok(content.includes("appinstalled"), "InstallGuideBanner must listen to appinstalled event");
});

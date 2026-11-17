// Visual checks use the actual page, form, and styles with synthetic test_ state.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const root = process.cwd();
const phase = process.argv[2] || 'after';
assert.ok(['before', 'after'].includes(phase));
const output = path.join(root, 'evidence/tasks/FOOD_UI_20261102/visual');
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'test_food_ui_visual_'));
let browser;
let server;
try {
  const css = process.env.FOOD_UI_STYLESHEET
    ? { css: await readFile(process.env.FOOD_UI_STYLESHEET, 'utf8') }
    : await postcss([tailwind({ base: root, optimize: true })]).process(
      await readFile(path.join(root, 'app/globals.css'), 'utf8'), { from: path.join(root, 'app/globals.css') });
  await build({
    absWorkingDir: root,
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import FoodLogPage from './app/food/log/page';
      import { FoodLogForm } from './components/records/FoodLogForm';
      import { AppHeader } from './components/ui/AppHeader';
      import { ToastProvider } from './components/ui/Toast';
      import { useBabyStore } from './stores/useBabyStore';
      const family = { id: 'test_family_visual', name: 'test_family_visual' };
      const baby = { id: 'test_baby_visual', familyId: family.id, nickname: 'test_baby_visual' };
      useBabyStore.setState({
        user: { id: 'test_user_visual', username: 'test_user_visual' }, family,
        families: [family], baby, babies: [baby], selectedBabyId: baby.id, authLoading: false,
        foodItems: [], fetchFoodItems: async () => {}, fetchUser: async () => null,
        addFoodLogRecord: async payload => { window.testSubmission = payload; },
      });
      window.fetch = async (url) => { throw new Error('Unexpected network call: ' + url); };
      const host = createRoot(document.getElementById('root'));
      window.testRender = (mode = 'create', data = {}) => {
        const page = mode === 'create' ? <FoodLogPage /> :
          <div data-preview-form="edit" className="min-h-[100dvh] bg-bg max-w-3xl mx-auto px-4 pt-4 pb-36" style={mode === 'drawer' ? { width: '480px', maxWidth: '100%', marginLeft: 'auto', marginRight: 0 } : undefined}>
            <AppHeader title="编辑辅食" showBack />
            <FoodLogForm mode="edit" initialData={data} onSubmit={async value => { window.testSubmission = value; }} />
          </div>;
        host.render(<ToastProvider key={Math.random()}><div className="app-wrapper">{page}</div></ToastProvider>);
      };
      window.testRender();
    ` },
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    outfile: path.join(temporary, 'test.js'), define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'next-preview-context', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'preview-nav' }));
      builder.onLoad({ filter: /.*/, namespace: 'preview-nav' }, () => ({ contents: 'const router={push(){},replace(){},back(){}}; export function useRouter(){return router;} export function usePathname(){return "/food/log";} export function useSearchParams(){return new URLSearchParams();}' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'preview-dynamic' }));
      builder.onLoad({ filter: /.*/, namespace: 'preview-dynamic' }, () => ({ contents: 'export default function dynamic(){return function UnopenedModal(){return null;};}' }));
      builder.onResolve({ filter: /(?:^|\/)QuickAiModal$/ }, () => ({ path: 'modal', namespace: 'preview-modal' }));
      builder.onLoad({ filter: /.*/, namespace: 'preview-modal' }, () => ({ contents: 'export function QuickAiModal(){return null;}' }));
    } }],
  });
  const javascript = await readFile(path.join(temporary, 'test.js'));
  server = createServer((request, response) => {
    if (request.url === '/test.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(javascript); }
    else if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/test.js"></script></html>'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3089, '127.0.0.2', resolve); });
  let executablePath = chromium.executablePath();
  if (!existsSync(executablePath)) {
    const cache = path.join(homedir(), '.cache/ms-playwright');
    executablePath = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
      .flatMap(name => ['chrome-linux-arm64/chrome', 'chrome-linux64/chrome'].map(binary => path.join(cache, name, binary)))
      .find(binary => existsSync(binary));
    assert.ok(executablePath);
  }
  browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.2:3089' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['2026-11-02T12:00:00Z'])); }
      static now() { return new OriginalDate('2026-11-02T12:00:00Z').getTime(); }
    };
  });
  const metrics = [];
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.2:3089');
    await page.getByRole('heading', { name: '辅食记录', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(output, `${phase}-${width}-full.png`), fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: path.join(output, `${phase}-${width}-top.png`), animations: 'disabled' });
    const metric = await page.evaluate(width => ({
      width, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
      controls: [...document.querySelectorAll('button,input,select,textarea')].filter(element => element.getBoundingClientRect().height > 0)
        .map(element => ({ name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40),
          width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })),
    }), width);
    metrics.push(metric);
    if (phase === 'after') {
      assert.equal(metric.scrollWidth, width, `page overflow at ${width}px`);
      const cod = page.getByRole('button', { name: '选择鳕鱼', exact: true });
      const bounds = await cod.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.width >= 100, 'ingredient target should be easy to tap');
      const category = await page.getByRole('button', { name: '常吃菜分类：鱼虾海鲜', exact: true }).boundingBox();
      assert.ok(category.height >= 44, 'category targets need at least 44px height');
      assert.ok(bounds.y < 800, 'primary ingredient chooser must be reachable on the first screen');
    }
  }
  if (phase === 'after') {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('http://127.0.0.2:3089');
    await page.getByRole('button', { name: '选择鳕鱼', exact: true }).click();
    await page.getByRole('button', { name: '选择虾', exact: true }).click();
    await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).fill('35');
    await page.screenshot({ path: path.join(output, 'after-390-selected.png'), fullPage: true, animations: 'disabled' });
    await page.getByLabel('搭配工具', { exact: true }).click();
    await page.getByRole('button', { name: '蛋白下一个', exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'after-390-tools.png'), fullPage: true, animations: 'disabled' });
    await page.goto('http://127.0.0.2:3089');
    await page.getByRole('button', { name: '+ 自定义食材', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'after-390-custom.png'), fullPage: true, animations: 'disabled' });
    await page.goto('http://127.0.0.2:3089');
    await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'after-390-dark-full.png'), fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: path.join(output, 'after-390-dark-top.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
    const components = [
      { role: 'protein', name: '鳕鱼', grams: 25 },
      { role: 'protein', name: '虾', grams: 15 },
      { role: 'vegetable', name: 'test_很长的自定义蔬菜和菌菇组合食材名称', grams: 32 },
    ];
    const data = { date: '2026-11-02', time: '12:00', foods: [...components.map(item => item.name), 'test_未知旧食材'], components, hasAbnormal: true, abnormalNotes: 'test_异常说明回填' };
    await page.evaluate(data => window.testRender('edit', data), data);
    await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'after-390-edit-long.png'), fullPage: true, animations: 'disabled' });
    await page.getByLabel('本餐食材', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.getByLabel('本餐食材', { exact: true }).screenshot({ path: path.join(output, 'after-390-edit-meal.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(data => window.testRender('drawer', data), data);
    await page.getByRole('spinbutton', { name: '鳕鱼克数', exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-preview-form="edit"]').screenshot({ path: path.join(output, 'after-480-drawer.png'), animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1280);
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, `${phase}-metrics.json`), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify({ phase, screenshots: phase === 'before' ? 8 : 16, metrics: metrics.map(({ controls, ...metric }) => metric), pageErrors: errors }));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}

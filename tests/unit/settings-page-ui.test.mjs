import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = mkdtempSync(join(tmpdir(), 'test-settings-page-ui-'));
const bundlePath = join(tempDir, 'bundle.js');
const storeStub = 'settings-page-test-store';
const browserEntry = `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import SettingsPage from './app/(main)/settings/page';
  import { ChatGPTPlanControls } from './components/ui/ChatGPTPlanControls';
  import { useBabyStore } from '@/stores/useBabyStore';

  function ChatCallerHarness() {
    const [isOpen, setIsOpen] = useState(true);
    return isOpen
      ? <div role="dialog" aria-label="测试对话弹窗">
          <ChatGPTPlanControls
            presentation="compact"
            disabled={false}
            onReadinessChange={() => {}}
            onClose={() => { sessionStorage.setItem('test-quick-ai-closed', 'true'); setIsOpen(false); }}
          />
        </div>
      : <p role="status">对话弹窗已关闭</p>;
  }

  if (window.location.pathname === '/compact') useBabyStore.setUser('test_user_chat');
  createRoot(document.getElementById('root')).render(
    window.location.pathname === '/compact' ? <ChatCallerHarness /> : <SettingsPage />
  );
`;

await build({
  stdin: { contents: browserEntry, resolveDir: projectRoot, loader: 'tsx' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  outfile: bundlePath,
  absWorkingDir: projectRoot,
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  plugins: [{
    name: 'settings-page-test-boundaries',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^@\/stores\/useBabyStore$/ }, () => ({ path: storeStub, namespace: 'test-stub' }));
      pluginBuild.onResolve({ filter: /^@\// }, args => {
        const base = resolve(projectRoot, args.path.slice(2));
        const resolved = ['.tsx', '.ts', '.jsx', '.js', '.json'].map(extension => base + extension).find(existsSync);
        return { path: resolved || base };
      });
      pluginBuild.onLoad({ filter: /.*/, namespace: 'test-stub' }, args => {
        return {
          loader: 'tsx',
          resolveDir: projectRoot,
          contents: `
            import { useSyncExternalStore } from 'react';
            const listeners = new Set();
            let state;
            function notify(next) { const previous = state; state = next; for (const listener of listeners) listener(state, previous); }
            async function fetchUser() {
              window.__testAuthFetchCount = (window.__testAuthFetchCount || 0) + 1;
              notify({ ...state, user: { id: 'test_user_settings' }, authLoading: false });
              return state.user;
            }
            const refreshAll = () => Promise.resolve();
            state = { user: null, authLoading: true, baby: null, fetchUser, refreshAll };
            function useBabyStore(selector) {
              return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => selector(state), () => selector(state));
            }
            useBabyStore.getState = () => state;
            useBabyStore.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
            useBabyStore.setState = next => notify({ ...state, ...next });
            useBabyStore.setUser = id => notify({ ...state, user: id ? { id } : null, authLoading: false });
            window.__testSetUser = useBabyStore.setUser;
            export { useBabyStore };
          `,
        };
      });
    },
  }],
});

const staticServer = createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(readFileSync(bundlePath));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
});
staticServer.listen(0, '127.0.0.1');
await once(staticServer, 'listening');
const origin = `http://127.0.0.1:${staticServer.address().port}`;

const profile = {
  id: 'test_api_settings', name: 'Test API Settings', provider: 'test-provider',
  textModel: 'test-settings-text', visionModel: 'test-settings-vision', available: true,
};
const snapshot = {
  preferences: [
    { feature: 'chat', source: 'api', profileId: profile.id, modelId: profile.textModel },
    { feature: 'daily_summary', source: 'api', profileId: profile.id, modelId: profile.textModel },
    { feature: 'tips', source: 'api', profileId: profile.id, modelId: profile.textModel },
    { feature: 'record_parse', source: 'api', profileId: profile.id, modelId: profile.textModel },
    { feature: 'nutrition_parse', source: 'api', profileId: profile.id, modelId: profile.visionModel },
    { feature: 'growth_ocr', source: 'api', profileId: profile.id, modelId: profile.visionModel },
    { feature: 'medical_ocr', source: 'api', profileId: profile.id, modelId: profile.visionModel },
    { feature: 'voice', source: 'api', profileId: profile.id, modelId: profile.textModel },
  ],
  profiles: [profile],
  activeProfileId: profile.id,
  defaultModelInfo: { source: 'api', provider: profile.provider, model: profile.textModel, profileId: profile.id },
};

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { executablePath: '/snap/bin/chromium' }),
  args: ['--no-sandbox'],
});

async function configurePage(page) {
  await page.addInitScript(() => {
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function () {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/ai/preferences' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: structuredClone(snapshot) }) });
      return;
    }
    if (url.pathname === '/api/ai/preferences' && request.method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: request.postDataJSON() }) });
      return;
    }
    if (url.pathname === '/api/ai/chatgpt') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profiles: [{ id: 'test_chat_account', email: 'test_user_chat@example.invalid', name: 'Test ChatGPT', connected: true, sharing: true }], pending: [] }) });
      return;
    }
    if (url.pathname === '/api/ai/sessions') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

test('direct settings entry restores identity and shows every AI feature without expansion', async () => {
  const context = await browser.newContext({ viewport: { width: 1050, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  let preferencesGets = 0;
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/ai/preferences') && request.method() === 'GET') preferencesGets += 1; });
  await configurePage(page);

  await page.goto(`${origin}/settings#ai-models`);
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  await page.waitForFunction(() => window.__testAuthFetchCount === 1);
  await page.getByLabel('聊天模型来源', { exact: true }).waitFor();
  await page.getByLabel('ChatGPT 账号', { exact: true }).waitFor();
  await page.getByLabel('API 配置', { exact: true }).waitFor();
  assert.equal(await page.locator('#ai-models details, #ai-models summary').count(), 0, 'AI settings are directly visible without details or summary controls');

  for (const feature of ['每日日报', '育儿建议', '记录解析', '营养识别', '生长记录 OCR', '医疗单据 OCR', '语音记录整理']) {
    const row = page.getByRole('region', { name: feature, exact: true });
    assert.equal(await row.isVisible(), true, `${feature} row is visible directly on settings`);
    assert.equal(await row.getByLabel(`${feature} API 配置`, { exact: true }).isVisible(), true);
    assert.equal(await row.getByLabel(`${feature} 模型`, { exact: true }).isVisible(), true);
    assert.equal(await row.getByRole('button', { name: '保存', exact: true }).isVisible(), true);
  }
  assert.equal(await page.locator('#ai-models').getAttribute('id'), 'ai-models');
  assert.equal(await page.getByRole('link', { name: '家庭 Passport' }).getAttribute('href'), '/family/passport');

  const getsBeforeLogout = preferencesGets;
  await page.evaluate(() => window.__testSetUser(null));
  await page.getByRole('link', { name: '登录', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="聊天模型来源"]')?.disabled === true);
  for (const feature of ['每日日报', '育儿建议', '记录解析', '营养识别', '生长记录 OCR', '医疗单据 OCR', '语音记录整理']) {
    assert.equal(await page.getByLabel(`${feature} API 配置`, { exact: true }).isDisabled(), true, `${feature} is not editable when logged out`);
  }
  assert.equal(preferencesGets, getsBeforeLogout, 'anonymous settings do not issue another preference fetch');
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test('QuickAiModal uses compact controls with its close callback', () => {
  const source = readFileSync(resolve(projectRoot, 'components/ui/QuickAiModal.tsx'), 'utf8');
  assert.match(source, /<ChatGPTPlanControls presentation="compact" disabled=\{loading\} onReadinessChange=\{setChatReadiness\} onClose=\{onClose\} \/>/);
});

test('compact chat settings show only current model and direct settings link, and invoke the caller close callback', async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await configurePage(page);

  await page.goto(`${origin}/compact`);
  await page.waitForTimeout(400);
  const compact = page.locator('[aria-label="聊天模型状态与设置"]');
  if (await compact.count() === 0) throw new Error(`compact controls did not render; body=${(await page.locator('body').innerText()).slice(0, 800)}; errors=${pageErrors.join(' | ')}`);
  await compact.getByRole('status', { name: '当前聊天模型' }).waitFor({ timeout: 5000 });
  await page.getByText(/当前模型：Test API Settings · test-settings-text/).waitFor();
  assert.equal(await compact.locator('select, details, summary').count(), 0, 'compact mode contains no editors or expandable controls');
  for (const feature of ['每日日报', '育儿建议', '记录解析', '营养识别', '生长记录 OCR', '医疗单据 OCR', '语音记录整理']) {
    assert.equal(await compact.getByText(feature, { exact: true }).count(), 0, `${feature} is hidden from compact chat controls`);
  }
  const modelSettingsLink = compact.getByRole('link', { name: '模型设置', exact: true });
  assert.equal(await modelSettingsLink.getAttribute('href'), '/settings#ai-models');
  await modelSettingsLink.click();
  await page.waitForURL(`${origin}/settings#ai-models`);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('test-quick-ai-closed')), 'true', 'the compact caller ran onClose before leaving chat');
  await page.locator('#ai-models').waitFor();
  assert.deepEqual(pageErrors, []);
  await context.close();
});

after(async () => {
  await browser.close();
  staticServer.closeAllConnections();
  await new Promise(resolve => staticServer.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
});

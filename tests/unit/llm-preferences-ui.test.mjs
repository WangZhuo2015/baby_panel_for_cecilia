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
const tempDir = mkdtempSync(join(tmpdir(), 'test-llm-preferences-ui-'));
const bundlePath = join(tempDir, 'bundle.js');
const stubPath = 'useBabyStore-test-stub';
const browserBundleEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { ChatGPTPlanControls } from './components/ui/ChatGPTPlanControls';
  createRoot(document.getElementById('root')).render(
    React.createElement(ChatGPTPlanControls, { disabled: false, onReadinessChange: () => {} })
  );
`;

const apiProfiles = [
  {
    id: 'test_api_alpha', name: 'Test API Alpha', provider: 'test-provider',
    textModel: 'test-alpha-text', visionModel: 'test-alpha-vision', available: true,
    apiKey: 'test_secret_must_not_cache', token: 'test_token_must_not_cache', baseUrl: 'https://secret.invalid',
  },
  {
    id: 'test_api_beta', name: 'Test API Beta', provider: 'test-provider',
    textModel: 'test-beta-text', visionModel: 'test-beta-vision', available: true,
    apiKey: 'test_secret_must_not_cache', token: 'test_token_must_not_cache', baseUrl: 'https://secret.invalid',
  },
];
const snapshots = {
  test_user_alpha: {
    preferences: [
      { feature: 'chat', source: 'chatgpt', profileId: 'test_chat_alpha', modelId: 'test_gpt_alpha' },
      { feature: 'daily_summary', source: 'api', profileId: 'test_api_alpha', modelId: 'test-alpha-text' },
    ],
    profiles: apiProfiles,
    activeProfileId: 'test_api_alpha',
    defaultModelInfo: { source: 'api', provider: 'test-provider', model: 'test-alpha-text', profileId: 'test_api_alpha' },
  },
  test_user_beta: {
    preferences: [
      { feature: 'chat', source: 'api', profileId: 'test_api_beta', modelId: 'test-beta-text' },
      { feature: 'daily_summary', source: 'api', profileId: 'test_api_beta', modelId: 'test-beta-text' },
    ],
    profiles: [apiProfiles[1]],
    activeProfileId: 'test_api_beta',
    defaultModelInfo: { source: 'api', provider: 'test-provider', model: 'test-beta-text', profileId: 'test_api_beta' },
  },
};

await build({
  stdin: { contents: browserBundleEntry, resolveDir: projectRoot, loader: 'tsx' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  outfile: bundlePath,
  absWorkingDir: projectRoot,
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  plugins: [{
    name: 'test-auth-store-stub',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^@\/stores\/useBabyStore$/ }, () => ({ path: stubPath, namespace: 'test-stub' }));
      pluginBuild.onResolve({ filter: /^@\// }, args => {
        const base = resolve(projectRoot, args.path.slice(2));
        const resolved = ['.tsx', '.ts', '.jsx', '.js', '.json'].map(extension => base + extension).find(existsSync);
        return { path: resolved || base };
      });
      pluginBuild.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
        loader: 'tsx',
        resolveDir: projectRoot,
        contents: `
          import { useSyncExternalStore } from 'react';
          let state = { user: { id: 'test_user_alpha' }, authLoading: false };
          const reactListeners = new Set();
          const stateListeners = new Set();
          function useBabyStore(selector) {
            return useSyncExternalStore(
              listener => { reactListeners.add(listener); return () => reactListeners.delete(listener); },
              () => selector(state),
              () => selector(state)
            );
          }
          useBabyStore.getState = () => state;
          useBabyStore.subscribe = listener => { stateListeners.add(listener); return () => stateListeners.delete(listener); };
          useBabyStore.setUser = id => {
            const previous = state;
            state = { user: id ? { id } : null, authLoading: false };
            for (const listener of stateListeners) listener(state, previous);
            for (const listener of reactListeners) listener();
          };
          window.__testSetUser = useBabyStore.setUser;
          export { useBabyStore };
        `,
      }));
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

const deferred = () => {
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
const waitForFlag = async (readFlag, label) => {
  const until = Date.now() + 7000;
  while (!readFlag()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const json = (value, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value) });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { executablePath: '/snap/bin/chromium' }),
  args: ['--no-sandbox'],
});

test('real UI keeps model choices available, persists the latest choice, restores safe cache, and isolates users', async () => {
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    let activeUser = 'test_user_alpha';
    let holdChatModels = true;
    let chatModelCalls = 0;
    let holdChatStatus = true;
    let chatStatusHeld = false;
    let chatStatusCompleted = false;
    const chatStatusGate = deferred();
    let chatModelsHeld = false;
    let alphaCatalogRefreshHeld = false;
    let betaCatalogRefreshHeld = false;
    let alphaCatalogRefreshCompleted = 0;
    const chatModelGate = deferred();
    const alphaCatalogRefreshGate = deferred();
    const betaCatalogRefreshGate = deferred();
    let holdFirstChatSave = false;
    let firstChatSaveHeld = false;
    const chatSaveGate = deferred();
    let holdFirstFeatureSave = false;
    let firstFeatureSaveHeld = false;
    const featureSaveGate = deferred();
    let holdAlphaPreferencesGet = false;
    let alphaPreferencesGetHeld = false;
    const alphaGetGate = deferred();
    const putLog = [];
    const prefsGetLog = [];

    await page.route('https://**/*', route => route.abort());
    await page.route('**/api/ai/preferences', async route => {
      const request = route.request();
      if (request.method() === 'GET') {
        const owner = activeUser;
        prefsGetLog.push(owner);
        if (owner === 'test_user_alpha' && holdAlphaPreferencesGet && !alphaPreferencesGetHeld) {
          alphaPreferencesGetHeld = true;
          await alphaGetGate.promise;
          try { await route.fulfill(json({ data: structuredClone(snapshots.test_user_alpha) })); } catch {}
          return;
        }
        try { await route.fulfill(json({ data: structuredClone(snapshots[owner] || { preferences: [], profiles: [], activeProfileId: '' }) })); } catch {}
        return;
      }

      const requested = request.postDataJSON();
      const owner = activeUser;
      putLog.push({ owner, body: requested });
      if (requested.feature === 'chat' && holdFirstChatSave && !firstChatSaveHeld) {
        firstChatSaveHeld = true;
        await chatSaveGate.promise;
      }
      if (requested.feature === 'daily_summary' && holdFirstFeatureSave && !firstFeatureSaveHeld) {
        firstFeatureSaveHeld = true;
        await featureSaveGate.promise;
      }
      const snapshot = structuredClone(snapshots[owner] || snapshots.test_user_beta);
      snapshot.preferences = snapshot.preferences.filter(item => item.feature !== requested.feature);
      snapshot.preferences.push(requested);
      snapshots[owner] = snapshot;
      try { await route.fulfill(json({ data: requested })); } catch {}
    });
    await page.route('**/api/ai/chatgpt**', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.searchParams.has('profile_id')) {
        const modelOwner = activeUser;
        const requestNumber = ++chatModelCalls;
        if (chatModelCalls === 1) {
          chatModelsHeld = true;
          await chatModelGate.promise;
        } else if (holdChatModels) {
          if (modelOwner === 'test_user_beta') { betaCatalogRefreshHeld = true; await betaCatalogRefreshGate.promise; }
          else { alphaCatalogRefreshHeld = true; await alphaCatalogRefreshGate.promise; }
        }
        try { await route.fulfill(json({ models: [
          { id: 'test_gpt_alpha', name: 'Test GPT Alpha', input: ['text'], apiKey: 'test_catalog_secret' },
          { id: 'test_gpt_beta', name: 'Test GPT Beta', input: ['text', 'image'], token: 'test_catalog_token' },
        ] })); } catch {}
        if (modelOwner === 'test_user_alpha' && requestNumber >= 3) alphaCatalogRefreshCompleted += 1;
        return;
      }
      if (holdChatStatus && !chatStatusHeld) {
        chatStatusHeld = true;
        await chatStatusGate.promise;
      }
      try {
        await route.fulfill(json({
          profiles: activeUser === 'test_user_beta'
            ? [{ id: 'test_chat_beta', email: 'test_user_beta@example.invalid', name: 'Test account beta', connected: true, sharing: true, reauthorize: false }]
            : [
              { id: 'test_chat_alpha', email: 'test_user_alpha@example.invalid', name: 'Test account alpha', connected: true, sharing: true, reauthorize: false },
              { id: 'test_chat_alpha_secondary', email: 'test_user_alpha_second@example.invalid', name: 'Test account alpha second', connected: true, sharing: true, reauthorize: false },
            ],
          pending: [],
        }));
        chatStatusCompleted = true;
      } catch {}
    });

    await page.goto(origin);
    const chatDetails = page.locator('section[aria-label="ChatGPT 订阅与模型"]');
    const featureDetails = page.locator('section[aria-label="其他功能的模型配置"]');
    assert.equal(await page.locator('details').count(), 0, 'model controls must be visible without expanding a menu');
    await page.getByLabel('聊天模型来源', { exact: true }).waitFor();
    await page.getByLabel('每日日报 API 配置', { exact: true }).waitFor();
    await waitForFlag(() => chatModelsHeld, 'ChatGPT models request to hang');
    await waitForFlag(() => chatStatusHeld, 'ChatGPT account status request to hang');
    assert.equal(prefsGetLog.length, 1, 'settings shares a single preferences request with feature rows');
    const tipsRow = page.getByRole('region', { name: '育儿建议', exact: true });
    await tipsRow.getByLabel('育儿建议 API 配置', { exact: true }).selectOption('test_api_beta');
    await tipsRow.getByRole('button', { name: '保存', exact: true }).click();
    await waitForFlag(() => putLog.some(item => item.body.feature === 'tips'), 'API feature save while ChatGPT status and catalog are pending');
    assert.deepEqual(putLog.find(item => item.body.feature === 'tips').body, {
      feature: 'tips', source: 'api', profileId: 'test_api_beta', modelId: 'test-beta-text',
    });
    chatStatusGate.resolve();
    holdChatStatus = false;
    await waitForFlag(() => chatStatusCompleted, 'ChatGPT account status refresh');
    const source = page.getByLabel('聊天模型来源', { exact: true });
    assert.equal(await source.isEnabled(), true, 'ChatGPT model loading must not disable source selection');
    const firstVisitModel = page.getByLabel('ChatGPT 模型', { exact: true });
    assert.equal(await firstVisitModel.isEnabled(), true, 'the saved model remains visible as a placeholder without a catalog cache');
    assert.equal(await firstVisitModel.inputValue(), 'test_gpt_alpha');

    holdFirstChatSave = true;
    await source.selectOption('api');
    await waitForFlag(() => firstChatSaveHeld, 'first chat API preference save');
    const chatProfile = page.getByLabel('API 配置', { exact: true });
    assert.equal(await chatProfile.isEnabled(), true, 'a pending ChatGPT pull or chat save must not lock API 配置 selection');
    await chatProfile.selectOption('test_api_beta');
    assert.equal(await chatProfile.inputValue(), 'test_api_beta');
    chatSaveGate.resolve();
    await waitForFlag(() => putLog.filter(item => item.body.feature === 'chat').length >= 2, 'latest chat preference save');
    assert.equal(putLog.filter(item => item.body.feature === 'chat').at(-1).body.profileId, 'test_api_beta');
    await page.getByText('模型配置已保存。', { exact: true }).waitFor();
    holdFirstChatSave = false;
    chatModelGate.resolve();

    // A later successful remote refresh seeds only safe catalog metadata.
    holdChatModels = false;
    await source.selectOption('chatgpt');
    await page.waitForFunction(() => document.querySelector('[aria-label=\"ChatGPT 模型\"]')?.options.length >= 2);
    await waitForFlag(() => putLog.filter(item => item.body.feature === 'chat').length >= 3, 'ChatGPT selection after catalog refresh');
    assert.equal(putLog.filter(item => item.body.feature === 'chat').at(-1).body.modelId, 'test_gpt_alpha');
    const chatEffort = page.getByLabel('AI 聊天推理强度', { exact: true });
    await chatEffort.locator('..').getByText('ChatGPT 套餐 · test_gpt_alpha', { exact: true }).waitFor();
    assert.equal(await chatEffort.isDisabled(), true);
    const dailyProfile = page.getByLabel('每日日报 API 配置', { exact: true });
    await dailyProfile.selectOption('test_api_beta');
    const dailySave = featureDetails.getByRole('button', { name: '保存', exact: true }).first();
    holdFirstFeatureSave = true;
    await dailySave.click();
    await waitForFlag(() => firstFeatureSaveHeld, 'first feature preference save');
    await dailyProfile.selectOption('test_api_alpha');
    featureSaveGate.resolve();
    await waitForFlag(() => putLog.filter(item => item.body.feature === 'daily_summary').length >= 2, 'latest feature preference save');
    assert.equal(putLog.filter(item => item.body.feature === 'daily_summary').at(-1).body.profileId, 'test_api_alpha');
    await featureDetails.getByText('已保存', { exact: true }).first().waitFor();
    holdFirstFeatureSave = false;

    const featureModelSelections = [
      { label: '每日日报', feature: 'daily_summary', vision: false, model: 'test_gpt_alpha', profileId: 'test_chat_alpha' },
      { label: '育儿建议', feature: 'tips', vision: false, model: 'test_gpt_alpha', profileId: 'test_chat_alpha' },
      { label: '记录解析', feature: 'record_parse', vision: false, model: 'test_gpt_alpha', profileId: 'test_chat_alpha' },
      { label: '营养识别', feature: 'nutrition_parse', vision: true, model: 'test_gpt_beta', profileId: 'test_chat_alpha' },
      { label: '生长记录 OCR', feature: 'growth_ocr', vision: true, model: 'test_gpt_beta', profileId: 'test_chat_alpha' },
      { label: '医疗单据 OCR', feature: 'medical_ocr', vision: true, model: 'test_gpt_beta', profileId: 'test_chat_alpha' },
      { label: '语音记录整理', feature: 'voice', vision: false, model: 'test_gpt_alpha', profileId: 'test_chat_alpha_secondary' },
    ];
    for (const item of featureModelSelections) {
      const row = page.getByRole('region', { name: item.label, exact: true });
      await row.getByLabel(item.label + ' 模型来源', { exact: true }).selectOption('chatgpt');
      await row.getByLabel(item.label + ' ChatGPT 账号', { exact: true }).selectOption(item.profileId);
      const modelSelect = row.getByLabel(item.label + ' 模型', { exact: true });
      await page.waitForFunction(label => {
        const select = document.querySelector('[aria-label="' + label + ' 模型"]');
        return select && Array.from(select.options).some(option => option.value === 'test_gpt_alpha' || option.value === 'test_gpt_beta');
      }, item.label);
      const allowedOptions = await modelSelect.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
      assert.deepEqual(
        allowedOptions,
        item.vision ? ['test_gpt_beta'] : ['test_gpt_alpha', 'test_gpt_beta'],
        item.vision ? item.label + ' must only offer image-capable GPT models' : item.label + ' must offer text-capable GPT models',
      );
      await modelSelect.selectOption(item.model);
      if (item.feature === 'daily_summary') {
        const effort = page.getByLabel('每日日报推理强度', { exact: true });
        await effort.locator('..').getByText('ChatGPT 套餐 · test_gpt_alpha', { exact: true }).waitFor();
        assert.equal(await effort.isDisabled(), true, 'choosing a subscription model disables effort before saving');
      }
      await row.getByRole('button', { name: '保存', exact: true }).click();
      await waitForFlag(() => putLog.some(entry => entry.owner === 'test_user_alpha'
        && entry.body.feature === item.feature && entry.body.source === 'chatgpt' && entry.body.modelId === item.model), item.feature + ' ChatGPT preference save');
      const saved = putLog.filter(entry => entry.owner === 'test_user_alpha' && entry.body.feature === item.feature).at(-1).body;
      assert.deepEqual(Object.keys(saved).sort(), ['feature', 'modelId', 'profileId', 'source']);
      assert.deepEqual(saved, { feature: item.feature, source: 'chatgpt', profileId: item.profileId, modelId: item.model });
    }

    await page.setViewportSize({ width: 320, height: 850 });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(hasHorizontalOverflow, false, 'AI model settings must fit a 320px viewport');
    await page.setViewportSize({ width: 1000, height: 900 });

    const dailySummaryRow = page.getByRole('region', { name: '每日日报', exact: true });
    await dailySummaryRow.getByLabel('每日日报 模型来源', { exact: true }).selectOption('api');
    await dailySummaryRow.getByLabel('每日日报 API 配置', { exact: true }).selectOption('test_api_alpha');
    await dailySummaryRow.getByRole('button', { name: '保存', exact: true }).click();
    await waitForFlag(() => putLog.filter(item => item.owner === 'test_user_alpha' && item.body.feature === 'daily_summary').at(-1)?.body.source === 'api', 'restore daily summary to API');

    const cachedJson = await page.evaluate(() => Object.keys(sessionStorage)
      .filter(key => key.startsWith('baby-panel:llm-preferences:v1:'))
      .map(key => sessionStorage.getItem(key)).join('\n'));
    assert.match(cachedJson, /test_user_alpha/);
    const allCachedJson = await page.evaluate(() => Object.keys(sessionStorage)
      .filter(key => key.startsWith('baby-panel:'))
      .map(key => sessionStorage.getItem(key)).join('\n'));
    assert.doesNotMatch(allCachedJson, /apiKey|test_secret_must_not_cache|test_token_must_not_cache|baseUrl|secret\.invalid|test_catalog_secret|test_catalog_token/);

    // Reopen while both preference and model-catalog refreshes are held. Cache must keep the saved choice and full list usable.
    holdChatModels = true;
    holdAlphaPreferencesGet = true;
    await page.reload();
    await waitForFlag(() => alphaPreferencesGetHeld, 'pending alpha preferences refresh');
    await waitForFlag(() => alphaCatalogRefreshHeld, 'pending cached ChatGPT model refresh');
    const heldCatalogCalls = chatModelCalls;
    assert.equal(await page.getByLabel('聊天模型来源', { exact: true }).inputValue(), 'chatgpt');
    const reopenedModel = page.getByLabel('ChatGPT 模型', { exact: true });
    assert.equal(await reopenedModel.isEnabled(), true, 'cached catalog remains selectable while the background refresh is pending');
    assert.equal(await reopenedModel.inputValue(), 'test_gpt_alpha', 'cached saved ChatGPT model restores immediately');
    assert.equal(await reopenedModel.locator('option').count(), 2, 'all cached model choices restore before refresh completes');

    // Re-enter ChatGPT while the catalog request is pending, choose a cached model, then let the older catalog response arrive.
    await source.selectOption('api');
    await page.waitForFunction(() => document.querySelector('[aria-label="聊天模型来源"]')?.value === 'api');
    await source.selectOption('chatgpt');
    await waitForFlag(() => chatModelCalls >= 3, 'cached alpha catalog refresh remains pending');
    assert.equal(chatModelCalls, heldCatalogCalls, 'the in-flight catalog request is shared instead of starting a duplicate request');
    await reopenedModel.selectOption('test_gpt_beta');
    await waitForFlag(() => putLog.filter(item => item.body.feature === 'chat').length >= 5, 'new cached ChatGPT model save');
    assert.equal(putLog.filter(item => item.body.feature === 'chat').at(-1).body.modelId, 'test_gpt_beta');
    alphaCatalogRefreshGate.resolve();
    await waitForFlag(() => alphaCatalogRefreshCompleted >= 1, 'late alpha catalog response');
    await page.getByText('使用 ChatGPT 套餐额度，与其他应用共享用量上限。', { exact: true }).waitFor();
    assert.equal(await reopenedModel.inputValue(), 'test_gpt_beta', 'late catalog response must not replace the locally selected model');
    assert.equal(putLog.filter(item => item.body.feature === 'chat').at(-1).body.modelId, 'test_gpt_beta', 'late catalog response must not persist an older model');

    await page.getByLabel('每日日报 API 配置', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('每日日报 API 配置', { exact: true }).inputValue(), 'test_api_alpha', 'feature selection also restores before the held GET completes');

    activeUser = 'test_user_beta';
    await page.evaluate(() => window.__testSetUser('test_user_beta'));
    await page.waitForFunction(() => document.querySelector('[aria-label="API 配置"]')?.value === 'test_api_beta');
    assert.equal(await page.getByLabel('聊天模型来源', { exact: true }).inputValue(), 'api');
    let catalogKeys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('baby-panel:chatgpt-model-catalog:v1:')));
    assert.deepEqual(catalogKeys, [], 'switching users must clear alpha ChatGPT catalog metadata');
    const profileCacheKeys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('baby-panel:chatgpt-profiles:v1:')));
    assert.deepEqual(profileCacheKeys, ['baby-panel:chatgpt-profiles:v1:test_user_beta'], 'switching users must clear alpha ChatGPT account metadata and keep only beta metadata');
    await page.getByLabel('聊天模型来源', { exact: true }).selectOption('chatgpt');
    await waitForFlag(() => betaCatalogRefreshHeld, 'beta model catalog request');
    assert.equal(await page.getByLabel('ChatGPT 账号', { exact: true }).inputValue(), 'test_chat_beta');
    const betaModelSelect = page.getByLabel('ChatGPT 模型', { exact: true });
    assert.equal(await betaModelSelect.isDisabled(), true, 'beta must not inherit alpha model options while its own catalog request is pending');
    assert.equal(await betaModelSelect.locator('option').count(), 1);
    assert.doesNotMatch(await betaModelSelect.locator('option').first().textContent(), /Test GPT/);
    assert.equal(await page.getByLabel('聊天模型来源', { exact: true }).isEnabled(), true, 'API source remains selectable during beta catalog loading');
    await page.getByLabel('聊天模型来源', { exact: true }).selectOption('api');
    await page.waitForFunction(() => document.querySelector('[aria-label="聊天模型来源"]')?.value === 'api');
    alphaGetGate.resolve();
    betaCatalogRefreshGate.resolve();
    await page.waitForTimeout(80);
    assert.equal(await page.getByLabel('API 配置', { exact: true }).inputValue(), 'test_api_beta', 'late alpha response must not overwrite beta UI');
    const ownerKeys = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('baby-panel:llm-preferences:v1:')));
    assert.deepEqual(ownerKeys, ['baby-panel:llm-preferences:v1:test_user_beta'], 'switching users must remove the previous user cache');
    const betaCache = await page.evaluate(key => sessionStorage.getItem(key), ownerKeys[0]);
    assert.doesNotMatch(betaCache, /test_api_alpha|test_user_alpha/);

    await page.evaluate(() => window.__testSetUser(null));
    await page.waitForFunction(() => document.querySelectorAll('select').length === 0 || document.querySelector('[aria-label="聊天模型来源"]')?.disabled === true);
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('baby-panel:'))), [], 'logout must clear all preference and model-catalog metadata');
    assert.ok(prefsGetLog.includes('test_user_beta'));
    assert.deepEqual(pageErrors, []);
    await context.close();
});

after(async () => {
  await browser.close();
  staticServer.closeAllConnections();
  await new Promise(resolve => staticServer.close(resolve));
  rmSync(tempDir, { recursive: true, force: true });
});

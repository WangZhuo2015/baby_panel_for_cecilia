import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('GPT effort follows the active model, verifies persistence, and rejects stale selections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-gpt-effort-ui-'));
  const bundle = join(dir, 'bundle.js');
  let server, browser;
  try {
    await build({ stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { GptEffortPreferences } from './components/ui/GptEffortPreferences';
      function App() {
        const [snapshot, setSnapshot] = React.useState(null);
        React.useEffect(() => { fetch('/api/ai/preferences').then(r => r.json()).then(r => setSnapshot(r.data)); }, []);
        return React.createElement(GptEffortPreferences, { userId: 'test_user_1', snapshot, loading: !snapshot, loadError: '', onConfirmed: setSnapshot });
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', outfile: bundle, alias: { '@': resolve('.') } });
    const official = { id: 'openai-official', name: 'Official API', provider: 'openai', textModel: 'gpt-6.2-sol', visionModel: 'gpt-6.2-sol', available: true };
    const amd = { id: 'amd-v4.1-flash', name: 'AMD', provider: 'amd', textModel: 'test-amd', visionModel: 'test-amd', available: true };
    const settings = {
      tips: { feature: 'tips', source: 'chatgpt', profileId: 'test_chatgpt', modelId: 'test-subscription-model' },
      growth_ocr: { feature: 'growth_ocr', source: 'api', profileId: 'openai-official', modelId: 'test-unknown-model' },
    };
    const writes = [];
    let discardEffort = false;
    server = createServer((req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(bundle)); return; }
      if (req.url === '/api/ai/preferences') {
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', data => { body += data; });
          req.on('end', () => {
            const selection = JSON.parse(body);
            writes.push(selection);
            if (!discardEffort) settings[selection.feature] = selection;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ data: selection }));
          });
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: { preferences: Object.values(settings), profiles: [official, amd] } }));
        return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<div id="root"></div><script src="/bundle.js"></script>');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText('API · test-amd', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('每日日报推理强度').isDisabled(), true);
    assert.equal(await page.getByLabel('育儿建议推理强度').isDisabled(), true);
    assert.equal(await page.getByLabel('成长记录识别推理强度').isDisabled(), true);
    await page.getByText('ChatGPT 套餐 · test-subscription-model', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('AI 聊天推理强度').locator('option[value=""]').textContent(), '默认（极高）');
    assert.equal(await page.getByLabel('语音助手推理强度').locator('option[value=""]').textContent(), '默认（低）');
    await page.getByLabel('AI 聊天推理强度').selectOption('max');
    await page.getByText('推理强度已保存。').waitFor();
    assert.equal(writes.at(-1).reasoningEffort, 'max');
    await page.getByLabel('医疗报告识别推理强度').selectOption('medium');
    await page.getByText('推理强度已保存。').waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[aria-label="AI 聊天推理强度"]')?.value === 'max');
    assert.equal(await page.getByLabel('医疗报告识别推理强度').inputValue(), 'medium');

    discardEffort = true;
    await page.getByLabel('医疗报告识别推理强度').selectOption('high');
    await page.getByText('推理强度未能保存，请重试。').waitFor();
    assert.equal(await page.getByLabel('医疗报告识别推理强度').inputValue(), 'medium');

    const writeCount = writes.length;
    settings.chat = { feature: 'chat', source: 'chatgpt', profileId: 'test_chatgpt', modelId: 'test-new-model' };
    await page.getByLabel('AI 聊天推理强度').selectOption('high');
    await page.getByText('模型配置已变更，请确认当前模型后重试。').waitFor();
    assert.equal(writes.length, writeCount);
    assert.equal(await page.getByLabel('AI 聊天推理强度').isDisabled(), true);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolveClose => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
});

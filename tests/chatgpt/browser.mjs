import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'test-baby-chatgpt-ui-'));
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ChatGPTPlanControls} from './components/ui/ChatGPTPlanControls'; createRoot(document.getElementById('root')).render(React.createElement(ChatGPTPlanControls,{disabled:false,onChange:value=>{window.selection=value;document.getElementById('selection').textContent=JSON.stringify(value||null);}}));`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', jsx: 'automatic', outfile: join(dir, 'bundle.js') });
let connected = true, pending = false, limited = false;
const requests = [];
const server = createServer(async (req, res) => {
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/bundle.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(readFileSync(join(dir, 'bundle.js'))); return; }
    if (req.url.startsWith('/api/ai/chatgpt')) {
        if (req.method === 'POST') {
            let raw = ''; for await (const part of req) raw += part; const input = JSON.parse(raw); requests.push(input);
            if (input.action === 'connect') { connected = true; pending = true; json({ id: 'test-attempt', profile_id: 'test-profile', authorization_url: 'https://auth.openai.com/api/accounts/authorize?state=test', callback_port: 14622, expires_at: Date.now() + 600000 }); }
            else { connected = false; pending = false; json({ revoked: true }); }
            return;
        }
        if (req.url.includes('profile_id=')) { if (limited) json({ error: 'chatgpt_usage_limit', message: 'ChatGPT 套餐已达到用量上限' }, 400); else json({ models: [{ id: 'test-gpt-a', name: 'Test GPT A' }, { id: 'test-gpt-b', name: 'Test GPT B' }] }); return; }
        json({ profiles: [{ id: 'test-profile', email: 'test_user@example.invalid', name: 'Test User', connected, sharing: true }], pending: pending ? [{ id: 'test-attempt', status: 'connected' }] : [] }); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:14px sans-serif;max-width:600px;margin:16px}select{max-width:70vw}button,a{margin:5px}</style><div id="root"></div><pre id="selection"></pre><script src="/bundle.js"></script>');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://auth.openai.com/**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('summary').click();
    await page.getByLabel('模型来源', { exact: true }).selectOption('test-profile');
    await page.waitForFunction(() => window.selection?.modelId === 'test-gpt-a');
    await page.getByLabel('ChatGPT 模型', { exact: true }).selectOption('test-gpt-b');
    await page.waitForFunction(() => window.selection?.modelId === 'test-gpt-b');
    await page.getByRole('button', { name: '断开连接', exact: true }).click();
    await page.waitForFunction(() => window.selection?.profileId === 'test-profile' && window.selection?.modelId === '');
    await page.getByRole('button', { name: '重新授权', exact: true }).click();
    await page.waitForFunction(() => window.selection?.modelId === 'test-gpt-a');
    assert.ok(requests.some(input => input.action === 'connect' && input.profile_id === 'test-profile'));
    limited = true;
    await page.getByLabel('模型来源', { exact: true }).selectOption('');
    await page.getByLabel('模型来源', { exact: true }).selectOption('test-profile');
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent.includes('用量上限'));
    assert.equal(await page.evaluate(() => window.selection?.profileId), 'test-profile');
    assert.equal(await page.evaluate(() => window.selection?.modelId), '');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/baby-chatgpt-mobile.png', fullPage: true });
    console.log('PASS: account/model selection, disconnect, same-account reconnect, quota failure without API fallback, mobile rendering.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }

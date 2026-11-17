import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { ChatGPTPlan, chatGPTPlanPayload, chatGPTPlanFetch, chatGPTPlanModel } from '../../lib/chatgpt-plan/core.mjs';
import { createModels, createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { Agent } from '@earendil-works/pi-agent-core';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const issue = payload => {
    const unsigned = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
    return unsigned + '.' + sign('sha256', Buffer.from(unsigned), privateKey).toString('base64url');
};

async function fixture(t, overrides = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'test-chatgpt-plan-')), calls = [];
    let clock = Date.now(), attempt, claims = {}, refresh = 0, refreshHook;
    const file = join(dir, 'private', 'chatgpt.json');
    const provider = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const form = new URLSearchParams(init.body);
        if (String(url).endsWith('/.well-known/openid-configuration')) return json({ issuer: 'https://auth.openai.com', jwks_uri: 'https://auth.openai.com/jwks', revocation_endpoint: 'https://auth.openai.com/revoke-test' });
        if (String(url).endsWith('/jwks')) return json({ keys: [jwk] });
        if (String(url).endsWith('/revoke-test')) return new Response(null, { status: 200 });
        if (String(url).endsWith('/models')) return json({ models: [{ slug: 'test-gpt-a', display_name: 'Test GPT A', visibility: 'list' }, { slug: 'test-gpt-b', display_name: 'Test GPT B', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] });
        assert.ok(String(url).endsWith('/oauth/token'));
        if (form.get('grant_type') === 'refresh_token') {
            refresh++; if (refreshHook) await refreshHook();
            return json({ access_token: 'TEST-ACCESS-REFRESHED', refresh_token: 'TEST-REFRESH-ROTATED', expires_in: 3600, token_type: 'Bearer' });
        }
        assert.equal(form.get('client_id'), 'oaiapp_test_registration');
        assert.equal(form.get('redirect_uri'), attempt.searchParams.get('redirect_uri'));
        assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), attempt.searchParams.get('code_challenge'));
        return json({ access_token: 'TEST-ACCESS-SECRET', refresh_token: 'TEST-REFRESH-SECRET', expires_in: 3600, token_type: 'Bearer', scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token: issue({ iss: 'https://auth.openai.com', aud: 'oaiapp_test_registration', sub: 'test-openai-user', email: 'test_alice@example.invalid', name: 'Test Alice', nonce: attempt.searchParams.get('nonce'), iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 3600, ...claims }) });
    };
    const plan = new ChatGPTPlan({ file, appName: 'Test Application', port: 0, fetcher: provider, now: () => clock, ...overrides });
    t.after(async () => { await plan.close(); rmSync(dir, { recursive: true, force: true }); });
    const start = async (owner = 'test_alice', options) => { const result = await plan.start(owner, options); attempt = new URL(result.authorization_url); return result; };
    const callback = async (a, params = {}) => {
        const url = new URL(attempt.searchParams.get('redirect_uri'));
        url.search = new URLSearchParams({ state: attempt.searchParams.get('state'), client_id: 'oaiapp_test_registration', code: 'TEST-CODE', ...params });
        return fetch(url, { redirect: 'error' });
    };
    const connect = async () => { const a = await start(); assert.equal((await callback(a)).status, 200); return a.profile_id; };
    return { plan, file, dir, calls, start, callback, connect, setClaims: value => { claims = value; }, advance: ms => { clock += ms; }, refreshCount: () => refresh, refreshHook: fn => { refreshHook = fn; }, authURL: () => attempt };
}

test('dynamic OAuth verifies signed identity, PKCE and nonce; tokens never appear in public status', async t => {
    const f = await fixture(t), a = await f.start();
    const url = f.authURL();
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('agent_name_hint'), 'Test Application');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal((await f.callback(a)).status, 200);
    const status = f.plan.status('test_alice');
    assert.equal(status.profiles[0].sharing, true); assert.equal(status.profiles[0].connected, true);
    assert.doesNotMatch(JSON.stringify(status), /TEST-ACCESS|TEST-REFRESH|idToken|accessToken|refreshToken/);
    assert.equal(await f.plan.access('test_alice', a.profile_id), 'TEST-ACCESS-SECRET');
    assert.equal(statSync(f.file).mode & 0o777, 0o600);
    assert.equal(statSync(join(f.dir, 'private')).mode & 0o777, 0o700);
    assert.equal((await f.callback(a)).status, 400, 'callback is single use');
});

test('rejects a forged identity signature and never treats identity-only consent as plan permission', async t => {
    const f = await fixture(t), seconds = Math.floor(Date.now() / 1000);
    const token = issue({ iss: 'https://auth.openai.com', aud: 'oaiapp_test_registration', sub: 'test-user', nonce: 'test-nonce', iat: seconds, exp: seconds + 3600 });
    const parts = token.split('.'), signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1; parts[2] = signature.toString('base64url');
    await assert.rejects(f.plan.identity(parts.join('.'), 'oaiapp_test_registration', 'test-nonce'), /chatgpt_auth_failed/);
    const original = f.plan.fetcher;
    f.plan.fetcher = async (url, init) => {
        const response = await original(url, init);
        if (!String(url).endsWith('/oauth/token')) return response;
        const data = await response.json(); data.scope = 'openid profile email'; return json(data);
    };
    const id = await f.connect();
    assert.equal(f.plan.status('test_alice').profiles[0].connected, true);
    assert.equal(f.plan.status('test_alice').profiles[0].sharing, false);
    await assert.rejects(f.plan.access('test_alice', id), /chatgpt_plan_disabled/);
});

test('accounts and model discovery remain isolated by the application owner', async t => {
    const f = await fixture(t), id = await f.connect();
    assert.deepEqual(f.plan.status('test_bob').profiles, []);
    await assert.rejects(f.plan.access('test_bob', id), /chatgpt_not_connected/);
    await assert.rejects(f.plan.models('test_bob', id), /chatgpt_not_connected/);
    assert.deepEqual((await f.plan.models('test_alice', id)).map(m => m.id), ['test-gpt-a', 'test-gpt-b']);
    assert.equal(f.calls.at(-1).init.headers.Authorization, 'Bearer TEST-ACCESS-SECRET');
});

test('host, issued client registration and usable credentials survive process replacement', async t => {
    const f = await fixture(t), id = await f.connect();
    const originalHost = f.authURL().searchParams.get('ext_agent_host_id');
    await f.plan.close();
    const restored = new ChatGPTPlan({ file: f.file, appName: 'Test Application', port: 0 }); t.after(() => restored.close());
    assert.equal(await restored.access('test_alice', id), 'TEST-ACCESS-SECRET');
    const a = await restored.start('test_alice', { profileId: id }), url = new URL(a.authorization_url);
    assert.equal(url.searchParams.get('client_id'), 'oaiapp_test_registration');
    assert.equal(url.searchParams.get('ext_agent_host_id'), originalHost);
    assert.equal(url.searchParams.has('agent_name_hint'), false);
});

test('wrong state, denied consent, expired attempts and changed app login cannot bind credentials', async t => {
    const f = await fixture(t); let authorized = true;
    const a = await f.start('test_alice', { authorized: () => authorized });
    assert.equal((await f.callback(a, { state: 'wrong' })).status, 400);
    assert.equal(f.calls.length, 0);
    authorized = false; assert.equal((await f.callback(a)).status, 400); assert.equal(f.calls.length, 0);
    authorized = true; assert.equal((await f.callback(a, { error: 'access_denied' })).status, 400);
    assert.equal(f.plan.status('test_alice').pending[0].error, 'chatgpt_auth_denied');
    const b = await f.start(); f.advance(600001); assert.equal((await f.callback(b)).status, 400);
    assert.deepEqual(f.plan.status('test_alice').profiles, []);
});

for (const [description, claims] of [['nonce', { nonce: 'forged' }], ['audience', { aud: 'other-client' }], ['issuer', { iss: 'https://evil.invalid' }], ['expiry', { exp: 1 }]]) {
    test('rejects an ID token with incorrect ' + description, async t => {
        const f = await fixture(t), a = await f.start(); f.setClaims(claims);
        assert.equal((await f.callback(a)).status, 400);
        assert.equal(f.plan.status('test_alice').profiles[0].connected, false);
        await assert.rejects(f.plan.access('test_alice', a.profile_id), /chatgpt_reauthorize/);
    });
}

test('refreshes a rotating token once for concurrent calls and persists its replacement', async t => {
    const f = await fixture(t), id = await f.connect(); f.advance(3550000);
    const values = await Promise.all([f.plan.access('test_alice', id), f.plan.access('test_alice', id), f.plan.access('test_alice', id)]);
    assert.deepEqual(values, Array(3).fill('TEST-ACCESS-REFRESHED')); assert.equal(f.refreshCount(), 1);
    assert.match(readFileSync(f.file, 'utf8'), /TEST-REFRESH-ROTATED/);
    assert.doesNotMatch(JSON.stringify(f.plan.status('test_alice')), /TEST-ACCESS|TEST-REFRESH/);
});

test('disconnect revokes via OIDC discovery and a racing refresh cannot restore credentials', async t => {
    const f = await fixture(t), id = await f.connect(); f.advance(3550000);
    let finish, started; const ready = new Promise(resolve => { started = resolve; });
    f.refreshHook(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const refreshing = f.plan.access('test_alice', id); const rejected = assert.rejects(refreshing, /chatgpt_not_connected/);
    await ready; assert.deepEqual(await f.plan.disconnect('test_alice', id), { revoked: true }); finish(); await rejected;
    assert.equal(f.plan.status('test_alice').profiles[0].connected, false);
    assert.doesNotMatch(readFileSync(f.file, 'utf8'), /TEST-ACCESS|TEST-REFRESH/);
});

test('unsafe or corrupt private credential files are rejected instead of silently overwritten', async t => {
    const f = await fixture(t); await f.plan.close();
    writeFileSync(f.file, '{}', { mode: 0o600 });
    assert.throws(() => new ChatGPTPlan({ file: f.file, appName: 'Test' }), /chatgpt_storage_invalid/);
    rmSync(f.file); symlinkSync(join(f.dir, 'elsewhere'), f.file);
    assert.throws(() => new ChatGPTPlan({ file: f.file, appName: 'Test' }), /chatgpt_storage_invalid/);
});

test('SIWC payload removes unsupported parameters and namespaces app tools and historical calls', () => {
    const payload = chatGPTPlanPayload({ model: 'test-gpt', store: true, stream: false, max_output_tokens: 4096, temperature: 0.7, previous_response_id: 'resp_old', metadata: {}, input: [{ type: 'message', role: 'system', content: 'rules' }, { type: 'function_call', name: 'read_state', call_id: 'call_x', arguments: '{}' }], tools: [{ type: 'function', name: 'read_state', parameters: { type: 'object' } }] });
    assert.equal(payload.store, false); assert.equal(payload.stream, true);
    for (const key of ['max_output_tokens', 'temperature', 'previous_response_id', 'metadata']) assert.equal(key in payload, false);
    assert.equal(payload.input[0].role, 'developer'); assert.equal(payload.input[1].namespace, 'functions');
    assert.equal(payload.tools[0].type, 'namespace'); assert.equal(payload.tools[0].tools[0].name, 'read_state');
});

function stream(events) { return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } }); }
function responseEvents(item) {
    const response = { id: 'resp_test', status: 'completed', model: 'test-gpt-a', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    return [{ type: 'response.created', response: { ...response, status: 'in_progress' } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } }, ...(item.type === 'message' ? [{ type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: item.content[0].text }] : [{ type: 'response.function_call_arguments.delta', output_index: 0, delta: item.arguments }]), { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
}

test('headerless SSE from the live subscription transport still completes a Pi turn', async t => {
    const f = await fixture(t), id = await f.connect();
    const providerFetch = chatGPTPlanFetch(f.plan, 'test_alice', id, { fetcher: async () => {
        const upstream = stream(responseEvents({ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }));
        return new Response(upstream.body); // The real transport can omit Content-Type.
    } });
    const model = chatGPTPlanModel('test-gpt-a'), models = createModels();
    models.setProvider(createProvider({ id: model.provider, name: 'Test', baseUrl: model.baseUrl, auth: { apiKey: envApiKeyAuth('Test', []) }, models: [model], api: openAIResponsesApi() }));
    const agent = new Agent({ initialState: { model, systemPrompt: 'Synthetic test only' }, getApiKey: () => f.plan.access('test_alice', id), streamFn: (m, context, options) => models.streamSimple(m, context, { ...options, fetch: providerFetch }) });
    await agent.prompt('Reply OK');
    assert.equal(agent.state.errorMessage, undefined);
    assert.equal(agent.state.messages.at(-1).stopReason, 'stop');
    assert.equal(agent.state.messages.at(-1).content[0].text, 'OK');
});

test('a missing content type does not turn an HTML/JSON body into a successful response', async t => {
    const f = await fixture(t), id = await f.connect();
    for (const body of ['<html>upstream unavailable</html>', '{"error":"upstream unavailable"}', 'data: {"type":"response.created","response":{"id":"resp_test"}}\n\n']) {
        const providerFetch = chatGPTPlanFetch(f.plan, 'test_alice', id, { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } })) });
        const response = await providerFetch('https://api.openai.com/v1/responses', { body: '{"input":[]}' });
        assert.equal(response.headers.get('content-type'), 'text/event-stream');
        await assert.rejects(response.text(), /chatgpt_unavailable/);
    }
});

test('real Pi Agent executes a namespaced tool and completes a two-request subscription turn', async t => {
    const f = await fixture(t), id = await f.connect(), payloads = []; let toolCalls = 0;
    const providerFetch = chatGPTPlanFetch(f.plan, 'test_alice', id, { fetcher: async (url, init) => {
        assert.equal(String(url), 'https://api.openai.com/v1/responses');
        assert.equal(init.headers.get('Authorization'), 'Bearer TEST-ACCESS-SECRET');
        const body = JSON.parse(init.body); payloads.push(body);
        assert.equal('max_output_tokens' in body, false); assert.equal(body.tools[0].type, 'namespace');
        return stream(responseEvents(payloads.length === 1 ? { type: 'function_call', id: 'fc_test', call_id: 'call_test', name: 'read_state', namespace: 'functions', arguments: '{}' } : { type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '合成电量为 62%。', annotations: [] }] }));
    } });
    const model = chatGPTPlanModel('test-gpt-a'), models = createModels();
    models.setProvider(createProvider({ id: model.provider, name: 'Test', baseUrl: model.baseUrl, auth: { apiKey: envApiKeyAuth('Test', []) }, models: [model], api: openAIResponsesApi() }));
    const agent = new Agent({ initialState: { model, systemPrompt: 'Synthetic test only', tools: [{ name: 'read_state', label: 'Read synthetic state', description: 'Read synthetic state', parameters: { type: 'object', properties: {} }, execute: async () => { toolCalls++; return { content: [{ type: 'text', text: '62%' }], details: {} }; } }] }, getApiKey: () => f.plan.access('test_alice', id), streamFn: (m, context, options) => models.streamSimple(m, context, { ...options, fetch: providerFetch }) });
    await agent.prompt('读取合成电量');
    assert.equal(agent.state.errorMessage, undefined); assert.equal(toolCalls, 1); assert.equal(payloads.length, 2);
    assert.ok(payloads[1].input.some(item => item.type === 'function_call_output'));
    assert.equal(agent.state.messages.at(-1).content[0].text, '合成电量为 62%。');
});

test('quota failures are translated and interrupted SSE is never a completed inference', async t => {
    const f = await fixture(t), id = await f.connect(); let error;
    const quota = chatGPTPlanFetch(f.plan, 'test_alice', id, { onError: code => { error = code; }, fetcher: async () => json({ error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'raw provider detail' } }, 429) });
    const response = await quota('https://api.openai.com/v1/responses', { body: '{"input":[]}' });
    assert.equal(response.status, 429); assert.equal(error, 'chatgpt_usage_limit'); assert.doesNotMatch(await response.text(), /raw provider detail/);
    const truncated = chatGPTPlanFetch(f.plan, 'test_alice', id, { fetcher: async () => stream([{ type: 'response.created', response: { id: 'resp_test' } }]) });
    await assert.rejects((await truncated('https://api.openai.com/v1/responses', { body: '{"input":[]}' })).text(), /chatgpt_unavailable/);
    const failure = chatGPTPlanFetch(f.plan, 'test_alice', id, { onError: code => { error = code; }, fetcher: async () => stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'raw provider detail' } } }]) });
    assert.doesNotMatch(await (await failure('https://api.openai.com/v1/responses', { body: '{"input":[]}' })).text(), /raw provider detail/);
    assert.equal(error, 'chatgpt_usage_limit');
});

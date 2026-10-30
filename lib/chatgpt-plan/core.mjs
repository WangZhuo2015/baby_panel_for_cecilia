// Official Sign in with ChatGPT flow. This module is also vendored by Baby Panel.
// Credentials stay in a private server-side file; browser APIs return public metadata only.
import { randomBytes, randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
export class ChatGPTPlanError extends Error {
    constructor(code) { super(code); this.code = code; }
}
const problem = code => new ChatGPTPlanError(code);
export function planErrorMessage(error) {
    return ({
        chatgpt_not_connected: '请先连接 ChatGPT 账号。',
        chatgpt_reauthorize: 'ChatGPT 授权已失效，请重新连接该账号。',
        chatgpt_plan_disabled: '尚未授权使用 ChatGPT 套餐，请重新连接并允许套餐使用。',
        chatgpt_usage_limit: 'ChatGPT 套餐或本应用已达到用量上限，请在 ChatGPT 设置中查看用量。',
        chatgpt_not_eligible: '当前 ChatGPT 账号或工作区尚不支持套餐接入。',
        chatgpt_unavailable: 'ChatGPT 服务暂不可用，请稍后重试。',
        chatgpt_model_unavailable: '所选模型已不可用，请刷新模型列表。',
        chatgpt_auth_denied: '已取消 ChatGPT 授权。',
        chatgpt_auth_failed: 'ChatGPT 授权未完成，请重新连接。',
        chatgpt_auth_busy: '连接请求过多，请稍后重试。',
        chatgpt_callback_unavailable: '本机授权端口无法启动，请检查端口配置。',
        chatgpt_storage_invalid: 'ChatGPT 凭据文件权限或格式不正确，请检查服务器配置。',
    })[error?.code || error?.message] || 'ChatGPT 连接暂不可用，请重试。';
}

function readStore(file) {
    let fd;
    try {
        fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 1048576) throw problem('chatgpt_storage_invalid');
        const data = JSON.parse(readFileSync(fd, 'utf8'));
        if (data.version !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(data.hostId) || !Array.isArray(data.profiles)) throw problem('chatgpt_storage_invalid');
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') return { version: 1, hostId: 'urn:uuid:' + randomUUID(), profiles: [] };
        throw problem('chatgpt_storage_invalid');
    } finally { if (fd !== undefined) closeSync(fd); }
}

export class ChatGPTPlan {
    constructor({ file, appName, port = 14621, bindHost = '127.0.0.1', fetcher = fetch, now = Date.now } = {}) {
        if (!file || !appName || !Number.isInteger(port) || port < 0 || port > 65535 || !['127.0.0.1', '0.0.0.0'].includes(bindHost)) throw problem('chatgpt_auth_failed');
        this.file = resolve(file); this.appName = appName; this.port = port; this.bindHost = bindHost; this.fetcher = fetcher; this.now = now;
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        this.data = readStore(this.file); this.pending = new Map(); this.refreshes = new Map(); this.catalogs = new Map();
        this.save();
    }
    save() {
        const temporary = this.file + '.' + randomBytes(12).toString('hex') + '.tmp';
        let fd;
        try {
            fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
            writeFileSync(fd, JSON.stringify(this.data)); fsyncSync(fd); closeSync(fd); fd = undefined;
            renameSync(temporary, this.file);
            fd = openSync(dirname(this.file), constants.O_RDONLY); fsyncSync(fd);
        } finally {
            if (fd !== undefined) closeSync(fd);
            try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    profile(owner, id) {
        const profile = this.data.profiles.find(p => p.owner === owner && p.id === id);
        if (!profile) throw problem('chatgpt_not_connected');
        return profile;
    }
    status(owner) {
        this.expire();
        return {
            profiles: this.data.profiles.filter(p => p.owner === owner).map(p => ({ id: p.id, email: p.email || '', name: p.name || p.email || 'ChatGPT', connected: Boolean(p.accessToken && !p.reauthorize), sharing: Boolean(p.scopes?.includes('chatgpt.tokens.use.direct')), reauthorize: Boolean(p.reauthorize) })),
            pending: [...this.pending.values()].filter(p => p.owner === owner).map(p => ({ id: p.id, status: p.status, ...(p.error ? { error: p.error, message: planErrorMessage(problem(p.error)) } : {}) })),
            callback_port: this.listener?.address()?.port || this.port,
            manage_usage_url: 'https://chatgpt.com/#settings/Usage',
        };
    }
    expire() { for (const [state, p] of this.pending) if (p.expires < this.now()) this.pending.delete(state); }
    async listen() {
        if (this.listening) return this.listening;
        this.listening = (async () => {
            const listener = createServer({ maxHeaderSize: 16384 }, (req, res) => { void this.callback(req, res); });
            this.listener = listener;
            listener.listen(this.port, this.bindHost); await once(listener, 'listening'); listener.unref();
            listener.on('error', () => {});
        })();
        try { await this.listening; } catch { this.listening = undefined; this.listener = undefined; throw problem('chatgpt_callback_unavailable'); }
    }
    async start(owner, { profileId, authorized = () => true } = {}) {
        this.expire();
        if (!owner || !authorized()) throw problem('chatgpt_auth_failed');
        if (this.pending.size >= 100 || [...this.pending.values()].filter(p => p.owner === owner && p.status === 'pending').length >= 3 || this.data.profiles.filter(p => p.owner === owner).length >= 8 && !profileId) throw problem('chatgpt_auth_busy');
        const profile = profileId ? this.profile(owner, profileId) : undefined;
        await this.listen();
        const state = random(), verifier = random(), nonce = random();
        const redirect = `http://127.0.0.1:${this.listener.address().port}/auth/callback`;
        const p = { id: randomUUID(), owner, profileId: profile?.id || randomUUID(), clientId: profile?.clientId, sub: profile?.sub, state, verifier, nonce, redirect, authorized, status: 'pending', expires: this.now() + 600000 };
        this.pending.set(state, p);
        const params = new URLSearchParams({ client_id: p.clientId || 'dynamic_agent_client', ext_agent_host_id: this.data.hostId, response_type: 'code', redirect_uri: redirect, scope: SCOPE, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
        if (!p.clientId) params.set('agent_name_hint', this.appName);
        if (profile?.idToken) params.set('id_token_hint', profile.idToken);
        if (profile?.email) params.set('login_hint', profile.email);
        return { id: p.id, profile_id: p.profileId, authorization_url: AUTH + '/api/accounts/authorize?' + params, callback_port: this.listener.address().port, expires_at: p.expires };
    }
    async callback(req, res) {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const p = this.pending.get(url.searchParams.get('state'));
        if (req.method !== 'GET' || url.pathname !== '/auth/callback' || !p || p.status !== 'pending' || p.expires < this.now() || !p.authorized()) { res.writeHead(400); res.end('Invalid or expired authorization. Return to the app and reconnect.'); return; }
        p.status = 'exchanging'; // Consume state before any asynchronous work.
        try {
            if (url.searchParams.has('error')) throw problem('chatgpt_auth_denied');
            const code = url.searchParams.get('code'), clientId = url.searchParams.get('client_id') || p.clientId;
            if (!code || code.length > 8192 || !/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId || '') || p.clientId && p.clientId !== clientId) throw problem('chatgpt_auth_failed');
            // Retain registration even if the authorization code expires during exchange.
            let profile = this.data.profiles.find(item => item.owner === p.owner && item.id === p.profileId);
            if (!profile) { profile = { id: p.profileId, owner: p.owner, clientId }; this.data.profiles.push(profile); this.save(); }
            const tokens = await this.json(AUTH + '/api/accounts/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: p.verifier, redirect_uri: p.redirect, resource: RESOURCE }).toString() });
            const identity = await this.identity(tokens.id_token, clientId, p.nonce);
            if (p.sub && p.sub !== identity.sub || !p.authorized() || this.pending.get(p.state) !== p || !this.data.profiles.includes(profile)) throw problem('chatgpt_auth_failed');
            this.setTokens(profile, tokens);
            Object.assign(profile, { clientId, sub: identity.sub, email: typeof identity.email === 'string' ? identity.email : '', name: typeof identity.name === 'string' ? identity.name : '', reauthorize: false });
            this.save(); this.catalogs.delete(profile.id); p.status = 'connected';
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('ChatGPT connected. You can close this window and return to the app.');
        } catch (error) {
            p.status = 'error'; p.error = error instanceof ChatGPTPlanError ? error.code : 'chatgpt_auth_failed';
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(planErrorMessage(problem(p.error)));
        } finally { delete p.verifier; delete p.nonce; }
    }
    async json(url, init = {}) {
        let response;
        try { response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
        catch { throw problem('chatgpt_unavailable'); }
        let size = 0, parts = [];
        for await (const chunk of response.body || []) { size += chunk.length; if (size > 1048576) throw problem('chatgpt_unavailable'); parts.push(Buffer.from(chunk)); }
        let data; try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw problem('chatgpt_unavailable'); }
        if (!response.ok) {
            if (data.error === 'invalid_grant' || response.status === 401) throw problem('chatgpt_reauthorize');
            throw problem(planResponseError(response.status, data));
        }
        return data;
    }
    async identity(token, clientId, nonce) {
        if (typeof token !== 'string' || token.length > 32768) throw problem('chatgpt_auth_failed');
        const parts = token.split('.'); if (parts.length !== 3) throw problem('chatgpt_auth_failed');
        const header = JSON.parse(Buffer.from(parts[0], 'base64url')), payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
        if (!['RS256', 'ES256'].includes(header.alg) || typeof header.kid !== 'string' || header.crit) throw problem('chatgpt_auth_failed');
        if (!this.discovery) {
            const discovery = await this.json(AUTH + '/.well-known/openid-configuration');
            if (discovery.issuer !== AUTH || new URL(discovery.jwks_uri).origin !== AUTH) throw problem('chatgpt_auth_failed');
            this.discovery = discovery;
        }
        if (!this.jwks || this.jwksExpires < this.now() || !this.jwks.keys.some(key => key.kid === header.kid)) { this.jwks = await this.json(this.discovery.jwks_uri); this.jwksExpires = this.now() + 300000; }
        const jwk = this.jwks.keys.find(key => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === 'sig') && key.kty === (header.alg === 'RS256' ? 'RSA' : 'EC'));
        if (!jwk || !verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))) throw problem('chatgpt_auth_failed');
        const seconds = this.now() / 1000;
        const audienceOK = Array.isArray(payload.aud) ? payload.aud.includes(clientId) && (payload.aud.length === 1 && !payload.azp || payload.azp === clientId) : payload.aud === clientId && (!payload.azp || payload.azp === clientId);
        if (payload.iss !== AUTH || !audienceOK || typeof payload.exp !== 'number' || payload.exp <= seconds || typeof payload.iat !== 'number' || payload.iat > seconds + 60 || payload.nbf && payload.nbf > seconds + 60 || payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) throw problem('chatgpt_auth_failed');
        return payload;
    }
    setTokens(profile, tokens) {
        if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 32768 || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer') throw problem('chatgpt_auth_failed');
        profile.accessToken = tokens.access_token; profile.expiresAt = this.now() + tokens.expires_in * 1000;
        if (typeof tokens.refresh_token === 'string') profile.refreshToken = tokens.refresh_token;
        if (typeof tokens.id_token === 'string') profile.idToken = tokens.id_token;
        if (typeof tokens.scope === 'string') profile.scopes = tokens.scope.split(/\s+/);
    }
    async access(owner, id) {
        const p = this.profile(owner, id);
        if (p.reauthorize || p.revoking || !p.accessToken) throw problem('chatgpt_reauthorize');
        if (!p.scopes?.includes('chatgpt.tokens.use.direct')) throw problem('chatgpt_plan_disabled');
        if (p.expiresAt <= this.now() + 60000) {
            if (!p.refreshToken) throw problem('chatgpt_reauthorize');
            if (!this.refreshes.has(id)) {
                const generation = p.generation || 0;
                const refresh = (async () => {
                    try {
                        const tokens = await this.json(AUTH + '/api/accounts/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: p.clientId, refresh_token: p.refreshToken, resource: RESOURCE }).toString() });
                        if (!this.data.profiles.includes(p) || (p.generation || 0) !== generation) throw problem('chatgpt_not_connected');
                        this.setTokens(p, tokens); this.save();
                    } catch (error) { if (error.code === 'chatgpt_reauthorize' && this.data.profiles.includes(p)) { p.reauthorize = true; this.save(); } throw error; }
                })();
                this.refreshes.set(id, refresh);
            }
            const pendingRefresh = this.refreshes.get(id);
            try { await pendingRefresh; } finally { if (this.refreshes.get(id) === pendingRefresh) this.refreshes.delete(id); }
        }
        if (!this.data.profiles.includes(p) || p.revoking || p.reauthorize) throw problem('chatgpt_not_connected');
        if (!p.scopes?.includes('chatgpt.tokens.use.direct')) throw problem('chatgpt_plan_disabled');
        return p.accessToken;
    }
    async models(owner, id) {
        const token = await this.access(owner, id), cached = this.catalogs.get(id);
        if (cached && cached.expires > this.now()) return cached.models;
        const data = await this.json(RESOURCE + '/models', { headers: { Authorization: 'Bearer ' + token } });
        if (!Array.isArray(data.models)) throw problem('chatgpt_unavailable');
        const models = data.models.filter(m => m.visibility === 'list' && idPattern.test(m.slug || '')).slice(0, 100).map(m => ({ id: m.slug, name: typeof m.display_name === 'string' ? m.display_name : m.slug, input: Array.isArray(m.input_modalities) ? m.input_modalities : ['text', 'image'] }));
        if (!models.length) throw problem('chatgpt_model_unavailable');
        this.catalogs.set(id, { models, expires: this.now() + 60000 }); return models;
    }
    async disconnect(owner, id) {
        const p = this.profile(owner, id);
        p.revoking = true; p.generation = (p.generation || 0) + 1;
        // Cancel pending reauthorization before revoking, including in-progress exchanges.
        for (const [state, pending] of this.pending) if (pending.owner === owner && pending.profileId === id) this.pending.delete(state);
        let revoked = !p.refreshToken;
        if (p.refreshToken) {
            try {
                const discovery = this.discovery || await this.json(AUTH + '/.well-known/openid-configuration');
                if (new URL(discovery.revocation_endpoint).origin !== AUTH) throw problem('chatgpt_auth_failed');
                const response = await this.fetcher(discovery.revocation_endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: p.refreshToken, token_type_hint: 'refresh_token', client_id: p.clientId }).toString() });
                revoked = response.status === 200; await response.body?.cancel();
            } catch { /* The caller reports that remote revocation was not confirmed. */ }
        }
        delete p.accessToken; delete p.refreshToken; delete p.idToken; delete p.revoking; p.reauthorize = true;
        this.catalogs.delete(id); this.save(); return { revoked };
    }
    async close() {
        this.pending.clear();
        if (this.listener?.listening) { this.listener.closeAllConnections(); await new Promise(resolve => this.listener.close(resolve)); }
        this.listener = undefined; this.listening = undefined;
    }
}

export function planResponseError(status, data) {
    const code = data?.error?.code;
    if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) return 'chatgpt_usage_limit';
    if (code === 'subscription_sharing_user_not_eligible' || status === 403) return 'chatgpt_not_eligible';
    if (status === 401) return 'chatgpt_reauthorize';
    return 'chatgpt_unavailable';
}

// Pi emits ordinary Responses payloads. SIWC currently accepts a narrower contract.
export function chatGPTPlanPayload(payload) {
    const result = { ...payload, store: false, stream: true };
    for (const key of ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent', 'prompt', 'prompt_cache_retention', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id']) delete result[key];
    result.input = (Array.isArray(result.input) ? result.input : []).map(item => item.role === 'system' ? { ...item, role: 'developer' } : ['function_call', 'custom_tool_call'].includes(item.type) ? { ...item, namespace: 'functions' } : item);
    if (Array.isArray(result.tools) && result.tools.length) result.tools = [{ type: 'namespace', name: 'functions', description: 'Application tools', tools: result.tools }];
    return result;
}

export function chatGPTPlanModel(id, input = ['text', 'image']) {
    // Leave reasoning at the account/model default: the catalog can also contain
    // models that do not accept an explicit reasoning effort.
    return { id, name: id, api: 'openai-responses', provider: 'chatgpt-plan', baseUrl: RESOURCE, reasoning: false, input, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096, compat: { supportsStrictMode: false, supportsToolSearch: false, supportsAdditionalTools: false } };
}

export function chatGPTPlanFetch(plan, owner, profileId, { fetcher = fetch, onError = () => {} } = {}) {
    return async (url, init) => {
        if (String(url) !== RESOURCE + '/responses') throw problem('chatgpt_unavailable');
        let token;
        try { token = await plan.access(owner, profileId); }
        catch (error) { onError(error.code || 'chatgpt_unavailable'); throw error; }
        const headers = new Headers(init?.headers); headers.set('Authorization', 'Bearer ' + token);
        const response = await fetcher(url, { ...init, headers, body: JSON.stringify(chatGPTPlanPayload(JSON.parse(init.body))), redirect: 'error' });
        if (!response.ok) {
            let data; try { data = await response.json(); } catch { data = {}; }
            const code = planResponseError(response.status, data); onError(code);
            return new Response(JSON.stringify({ error: { code, message: planErrorMessage(problem(code)) } }), { status: response.status, headers: { 'Content-Type': 'application/json' } });
        }
        const contentType = response.headers.get('content-type');
        // Some subscription transports omit Content-Type even for a complete
        // SSE response. Keep validating the actual events through the terminal
        // response below, and provide the media type expected by the SDK.
        if (!response.body || contentType && !contentType.toLowerCase().includes('text/event-stream')) {
            await response.body?.cancel(); onError('chatgpt_unavailable'); throw problem('chatgpt_unavailable');
        }
        const streamHeaders = new Headers(response.headers);
        if (!contentType) streamHeaders.set('Content-Type', 'text/event-stream');
        let buffer = '', terminal = false;
        const decoder = new TextDecoder(), encoder = new TextEncoder();
        const processFrame = frame => {
            const line = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (line && line !== '[DONE]') {
                const event = JSON.parse(line);
                if (event.type === 'response.completed') terminal = true;
                if (event.type === 'response.incomplete') { onError('chatgpt_unavailable'); throw problem('chatgpt_unavailable'); }
                if (event.type === 'response.failed' || event.type === 'error') {
                    terminal = true;
                    const code = planResponseError(0, event.response || event); onError(code);
                    const error = event.response?.error || event.error;
                    if (error && typeof error === 'object') error.message = planErrorMessage(problem(code));
                    return 'data: ' + JSON.stringify(event) + '\n\n';
                }
            }
            return frame + '\n\n';
        };
        const stream = response.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                buffer += decoder.decode(chunk, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
                if (buffer.length > 1048576) throw problem('chatgpt_unavailable');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) >= 0) { controller.enqueue(encoder.encode(processFrame(buffer.slice(0, boundary)))); buffer = buffer.slice(boundary + 2); }
            },
            flush(controller) {
                buffer += decoder.decode();
                if (buffer.trim()) controller.enqueue(encoder.encode(processFrame(buffer)));
                if (!terminal) { onError('chatgpt_unavailable'); throw problem('chatgpt_unavailable'); }
            },
        }));
        return new Response(stream, { status: response.status, headers: streamHeaders });
    };
}

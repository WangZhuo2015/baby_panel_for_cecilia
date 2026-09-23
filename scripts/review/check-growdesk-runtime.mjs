/** Next.js HTTP wiring smoke against a synthetic upstream; NOT PostgreSQL/browser E2E. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const family = { id: 'test_family_runtime', name: 'test_family_runtime', timeZone: 'Asia/Shanghai' };
const baby = { id: 'test_baby_runtime', familyId: family.id, name: 'test_baby_runtime', gender: 'girl', birthDate: '2026-01-01', avatarUrl: null, gestationalWeeks: 38, gestationalDays: 0 };
const user = { id: 'test_user_runtime', username: 'test_user_runtime', displayName: 'test_user_runtime' };
const feedingDetail = { id: 'test_feed_runtime', babyId: baby.id, familyId: family.id, feedingType: 'mixed', occurredAt: '2026-09-12T08:15:00.000Z', amountMl: '85', leftMinutes: 7, rightMinutes: 3, spitUp: false, formulaProductId: null, notes: 'test_original_note', source: 'ui_manual', sourceAgent: null, version: '4' };
let outage = false;
let secretHash;
let notificationFailure = false;
const upstream = http.createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('content-type', 'application/json');
  if (outage) { res.writeHead(503); res.end(JSON.stringify({ error: { code: 'TEST_OUTAGE', message: 'test unavailable' } })); return; }
  const send = data => res.end(JSON.stringify({ data }));
  if (url.pathname === '/api/v1/auth/bff/session') {
    if (body.username === user.username) secretHash = body.sessionSecretHash;
    if (!secretHash || body.sessionSecretHash !== secretHash) { res.writeHead(401); res.end('{}'); return; }
    if (req.method === 'DELETE') { secretHash = null; send({ success: true }); return; }
    send({ accessToken: 'test_access_token', user }); return;
  }
  if (req.headers.authorization !== 'Bearer test_access_token') { res.writeHead(401); res.end('{}'); return; }
  if (url.pathname === '/api/v1/families') { send([family]); return; }
  if (url.pathname === `/api/v1/families/${family.id}/babies`) { send([baby]); return; }
  if (url.pathname === `/api/v1/families/${family.id}/members`) {
    send([{
      id: 'test_membership_runtime',
      userId: user.id,
      familyId: family.id,
      role: 'admin',
      username: user.username,
      displayName: user.displayName,
      relation: 'parent',
      joinedAt: '2026-01-01T00:00:00.000Z',
    }]);
    return;
  }
  if (url.pathname === `/api/v1/families/${family.id}`) { send(family); return; }
  if (url.pathname === `/api/v1/babies/${baby.id}`) { send(baby); return; }
  if (url.pathname.endsWith(`/records/feeding/${feedingDetail.id}`)) { send(feedingDetail); return; }
  if (url.pathname.endsWith('/records/feeding')) { res.end(JSON.stringify({ data: [], page: { nextCursor: null } })); return; }
  if (url.pathname === '/api/v1/notifications') {
    if (notificationFailure) { res.writeHead(503); res.end(JSON.stringify({ error: { code: 'TEST_NOTIFICATION_OUTAGE', message: 'test notification outage' } })); return; }
    res.end(JSON.stringify({ data: [{ id: 'notif_1', userId: user.id, eventKey: 'daily.summary', title: '今日日报', body: '测试内容', readAt: null, createdAt: new Date().toISOString() }], page: { nextCursor: null } })); return;
  }
  if ([`/api/v1/babies/${baby.id}/records/sleep`, `/api/v1/babies/${baby.id}/records/diaper`, `/api/v1/babies/${baby.id}/records/food`, `/api/v1/babies/${baby.id}/records/supplement`, `/api/v1/babies/${baby.id}/growth-measurements`].includes(url.pathname)) {
    res.end(JSON.stringify({ data: [], page: { nextCursor: null } })); return;
  }
  if ([`/api/v1/babies/${baby.id}/vaccines/records`, `/api/v1/babies/${baby.id}/vaccines/schedule`].includes(url.pathname)) { send([]); return; }
  if (url.pathname === `/api/v1/babies/${baby.id}/food-plan`) { send({ id: null, babyId: baby.id, createdAt: null, updatedAt: '2026-01-01T00:00:00.000Z', planData: {}, version: '0' }); return; }
  if (url.pathname === '/api/v1/development/milestones') {
    res.end(JSON.stringify({ data: [], dataRelease: { id: 'test_release', title: 'test_reference', asOf: '2026-01-01', sources: [{ organization: 'test_organization' }] } })); return;
  }
  if (url.pathname.startsWith('/api/v1/devices/')) { send({ success: true }); return; }
  res.writeHead(404); res.end('{}');
});
let child;
let logs = '';
try {
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['.next/standalone/server.js'], { env: {
    ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
    GROWDESK_ENABLED: 'true', GROWDESK_BACKEND: 'go', GROWDESK_WEB_ORIGIN: origin,
    GROWDESK_API_URL: '',
    GROWDESK_GO_API_URL: `http://127.0.0.1:${upstream.address().port}`,
    DATABASE_URL: 'file:./dev_test.db', JWT_SECRET: 'test_runtime_only_012345678901234567890123456789',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Next exited ${child.exitCode}`);
    try { const r = await fetch(`${origin}/api/auth/me`, { signal: AbortSignal.timeout(1000) }); if (r.status === 200) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Next runtime must become ready');
  const call = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
  const login = await call('/api/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: user.username, password: 'test_password' }) });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).baby.nickname, baby.name);
  const setCookies = login.headers.getSetCookie();
  const session = setCookies.find(value => value.startsWith('__Host-growdesk_web='));
  assert.ok(session?.includes('Secure') && session.includes('HttpOnly'));
  const cookie = session.split(';')[0];
  const me = await call('/api/auth/me', { headers: { cookie } });
  assert.equal(me.status, 200); assert.equal((await me.json()).user.id, user.id);
  const selected = await call(`/api/baby?babyId=${baby.id}`, { headers: { cookie } });
  assert.equal(selected.status, 200); assert.equal((await selected.json()).id, baby.id);
  const feeding = await call(`/api/records/feeding?babyId=${baby.id}&date=2026-09-13`, { headers: { cookie } });
  assert.equal(feeding.status, 200); assert.deepEqual(await feeding.json(), []);
  const legacyDetail = await call(`/api/records/feeding?babyId=${baby.id}&id=${feedingDetail.id}`, { headers: { cookie } });
  assert.equal(legacyDetail.status, 200);
  const legacyRecord = await legacyDetail.json();
  assert.equal(legacyRecord.amountMl, 85);
  assert.equal(Object.hasOwn(legacyRecord, 'version'), false, 'default DTO must retain the legacy contract');
  const detail = await call(`/api/records/feeding?babyId=${baby.id}&id=${feedingDetail.id}`, {
    headers: { cookie, "x-growdesk-representation": "extended" },
  });
  assert.equal(detail.status, 200);
  const editRecord = await detail.json();
  assert.equal(editRecord.timestamp, feedingDetail.occurredAt);
  assert.equal(editRecord.type, 'mixed');
  assert.equal(editRecord.amountMl, 85);
  assert.equal(editRecord.notes, feedingDetail.notes);
  assert.equal(editRecord.version, '4');
  const notifs = await call('/api/notifications', { headers: { cookie } });
  assert.equal(notifs.status, 200);
  const notifList = await notifs.json();
  assert.ok(Array.isArray(notifList));
  assert.ok(notifList.some(item => item.id === 'notif_1'));
  assert.ok(notifList.some(item => item.id.startsWith('daily-feeding')));
  notificationFailure = true;
  const failedNotifications = await call('/api/notifications', { headers: { cookie } });
  assert.equal(failedNotifications.status, 503);
  assert.equal((await failedNotifications.json()).code, 'TEST_NOTIFICATION_OUTAGE');
  notificationFailure = false;
  const pushSub = await call('/api/push/subscribe', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://push.example.com/test_token' }),
  });
  assert.equal(pushSub.status, 200);
  assert.equal((await pushSub.json()).success, true);
  // Registration is bridged now; missing Origin must reach CSRF rejection, not the migration fence.
  assert.equal((await call('/api/auth/register', { method: 'POST' })).status, 403);
  assert.equal((await call('/api/baby', { method: 'PUT', headers: { cookie, origin: 'https://test_attacker.invalid' }, body: '{}' })).status, 403);
  outage = true;
  assert.equal((await call('/api/auth/me', { headers: { cookie } })).status, 503);
  assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { cookie, origin } })).status, 503);
  outage = false;
  assert.equal((await call('/api/auth/logout', { method: 'POST', headers: { cookie, origin } })).status, 200);
  assert.equal((await (await call('/api/auth/me', { headers: { cookie } })).json()).user, null);
  console.log('PASS: actual Next HTTP Go-backend selector, login/cookie/me/baby/feeding, capability fence, CSRF, outage and logout wiring. Synthetic upstream; no PostgreSQL or browser assertions.');
} catch (error) {
  console.error(logs); throw error;
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
}

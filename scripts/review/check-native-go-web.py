#!/usr/bin/env python3
"""Actual Next BFF -> pinned native Go -> owned PostgreSQL/Redis regression.

No existing database, account, listener or paid provider is accepted. This is
HTTP/database integration, not browser, visual, AI execution or S3 acceptance.
"""
from __future__ import annotations

import argparse
from http.cookies import SimpleCookie
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / 'scripts/review/go-api-baseline.json'
MAX_RESPONSE = 2 * 1024 * 1024
if not __debug__:
    raise RuntimeError('Optimized Python is forbidden: assertions must execute')


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


def identifier(value):
    assert isinstance(value, str) and str(uuid.UUID(value)) == value, 'Expected canonical generated UUID'
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(base, method, path, body=None, headers=None):
    target = urllib.parse.urlsplit(base)
    assert target.scheme == 'http' and target.hostname == '127.0.0.1'
    assert target.port and target.port not in (3088, 3089, 5432, 6379)
    assert path.startswith('/') and not path.startswith('//')
    hdr = {'Accept': 'application/json', **(headers or {})}
    raw = None
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        hdr['Content-Type'] = 'application/json'
    req = urllib.request.Request(base + path, data=raw, headers=hdr, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read(MAX_RESPONSE + 1)
        assert len(data) <= MAX_RESPONSE, 'Oversized test response'
        assert 'application/json' in response.headers.get('Content-Type', ''), 'Expected JSON, not redirect/HTML'
        return response.status, json.loads(data), response.headers


class Scenario:
    def __init__(self, owned, native, web, report):
        self.owned, self.native, self.web, self.report = owned, native, web, report
        self.cookie = ''
        self.calls = 0

    def call(self, base, method, path, expected, body=None, headers=None):
        self.calls += 1
        status, value, response_headers = request_json(base, method, path, body, headers)
        allowed = (expected,) if isinstance(expected, int) else expected
        if status not in allowed:
            code = value.get('code') if isinstance(value, dict) else None
            if isinstance(value, dict) and isinstance(value.get('error'), dict):
                code = value['error'].get('code')
            raise AssertionError(f'{method} {path.split("?")[0]} expected {allowed}, got {status}, code={code}')
        return value, response_headers

    def api(self, method, path, expected, body=None, token=None, key=None):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        if key: headers['Idempotency-Key'] = key
        return self.call(self.native, method, path, expected, body, headers)[0]

    def bff(self, method, path, expected, body=None, cookie=None, key=None, extended=False, origin=None):
        headers = {'Cookie': self.cookie if cookie is None else cookie}
        if method not in ('GET', 'HEAD'):
            headers['Origin'] = self.web if origin is None else origin
        if key: headers['Idempotency-Key'] = key
        if extended: headers['x-growdesk-representation'] = 'extended'
        return self.call(self.web, method, path, expected, body, headers)[0]

    def login(self, username, password):
        value, headers = self.call(self.web, 'POST', '/api/auth/login', 200,
            {'username': username, 'password': password}, {'Origin': self.web})
        assert 'accessToken' not in value and 'refreshToken' not in value
        cookies = SimpleCookie()
        for header in headers.get_all('Set-Cookie', []): cookies.load(header)
        session = cookies.get('__Host-growdesk_web')
        assert session and session['secure'] and session['httponly'] and session['path'] == '/' and not session['domain']
        return session.key + '=' + session.value, value

    def passed(self, name):
        self.report['cases'].append({'name': name, 'passed': True})
        print('PASS ' + name, flush=True)

    def feed_state(self, family):
        identifier(family)
        return json.loads(self.owned.sql(f"""SELECT jsonb_build_object(
            'feeding',(SELECT COUNT(*) FROM feeding_records WHERE family_id='{family}'),
            'timeline',(SELECT COUNT(*) FROM timeline_entries WHERE family_id='{family}'),
            'changes',(SELECT COUNT(*) FROM family_changes WHERE family_id='{family}'),
            'receipts',(SELECT COUNT(*) FROM idempotency_receipts WHERE scope_id='{family}'),
            'cursor',(SELECT cursor::text FROM family_sync_states WHERE family_id='{family}'));"""))

    def run(self):
        username = 'test_web_go_' + self.owned.owner
        password = 'test_password_' + secrets.token_hex(12)
        account = self.api('POST', '/api/v1/auth/register', 201,
            {'username': username, 'password': password, 'displayName': username, 'deviceLabel': 'test_web_go'})['data']
        owner, user_id = account['accessToken'], identifier(account['user']['id'])
        family = self.api('POST', '/api/v1/families', 201,
            {'name': 'test_family_web_go_' + self.owned.owner, 'timeZone': 'Asia/Tokyo'}, owner)['data']
        fid = identifier(family['id'])
        babies = [self.api('POST', f'/api/v1/families/{fid}/babies', 201,
            {'name': f'test_baby_web_go_{i}', 'birthDate': '2026-01-01', 'gender': 'girl'}, owner)['data'] for i in range(2)]
        bid, other_bid = (identifier(b['id']) for b in babies)
        self.cookie, login = self.login(username, password)
        assert login['user']['id'] == user_id
        assert self.bff('GET', '/api/auth/me', 200)['user']['id'] == user_id
        assert self.bff('GET', '/api/baby?babyId=' + bid, 200)['id'] == bid
        self.passed('real BFF login, protected cookie and explicit baby selection')

        feeding = {'babyId': bid, 'type': 'formula', 'amountMl': 120, 'timestamp': '2026-01-02T02:00:00.000Z', 'spitUp': False, 'notes': 'test_original_note'}
        before = self.feed_state(fid)
        created = self.bff('POST', '/api/records/feeding', 201, feeding, key='test_web_go_create')
        rid = identifier(created['id'])
        after = self.feed_state(fid)
        for field in ('feeding', 'timeline', 'changes', 'receipts'):
            assert after[field] == before[field] + 1, field + ' must commit exactly once'
        assert int(after['cursor']) == int(before['cursor']) + 1
        replay = self.bff('POST', '/api/records/feeding', 201, feeding, key='test_web_go_create')
        assert replay == created and self.feed_state(fid) == after
        self.bff('POST', '/api/records/feeding', 409, {**feeding, 'amountMl': 121}, key='test_web_go_create')
        assert self.feed_state(fid) == after
        self.passed('Web feeding create/replay persists exactly once in Go PostgreSQL')

        detail_path = f'/api/records/feeding?babyId={bid}&id={rid}'
        legacy = self.bff('GET', detail_path, 200)
        editable = self.bff('GET', detail_path, 200, extended=True)
        assert legacy['amountMl'] == 120 and legacy['timestamp'] == feeding['timestamp']
        assert 'version' not in legacy and editable['version'] == '1'
        changed = self.bff('PUT', '/api/records/feeding', 200,
            {'id': rid, 'babyId': bid, 'baseVersion': editable['version'], 'amountMl': 125, 'notes': 'test_updated_note'}, key='test_web_go_update')
        assert changed['version'] == '2' and changed['amountMl'] == 125
        stable = self.feed_state(fid)
        self.bff('PUT', '/api/records/feeding', 409,
            {'id': rid, 'babyId': bid, 'baseVersion': '1', 'amountMl': 999}, key='test_web_go_stale')
        self.bff('POST', '/api/records/feeding', 403, feeding, origin='https://test-attacker.invalid')
        assert self.feed_state(fid) == stable
        assert self.owned.sql(f"SELECT amount_ml=125 AND version=2 FROM feeding_records WHERE id='{rid}';") == 't'
        self.bff('GET', f'/api/records/feeding?babyId={other_bid}&id={rid}', 404)
        self.passed('legacy/extended DTOs, optimistic edits, CSRF and sibling baby isolation')

        base = f'/api/v1/babies/{bid}/records/'
        records = {'feeding': rid}
        fixtures = {
            'sleep': {'sleepType': 'night', 'startedAt': '2026-01-01T14:30:00.000Z', 'endedAt': '2026-01-02T01:00:00.000Z', 'nightWakingCount': 0, 'notes': 'test_cross_midnight'},
            'diaper': {'diaperType': 'both', 'occurredAt': '2026-01-02T02:10:00.000Z', 'poopColor': 'yellow', 'notes': None},
            'food': {'recordDate': '2026-01-02', 'mealType': 'lunch', 'occurredAt': '2026-01-02T02:20:00.000Z', 'foodItemIds': ['test_rice'], 'notes': 'test_food'},
        }
        for kind, payload in fixtures.items():
            row = self.api('POST', base + kind, 201, payload, owner, 'test_web_go_' + kind)['data']
            records[kind] = identifier(row['id'])
        catalog = f'/api/v1/families/{fid}/nutrition/supplement-products'
        product = self.api('POST', catalog, 201, {'name': 'test_vitamin', 'unitName': '滴', 'defaultDose': '9'}, owner)['data']
        pid = identifier(product['id'])
        supplement = self.api('POST', base + 'supplement', 201,
            {'supplementName': 'test_historical_vitamin', 'productId': pid, 'occurredAt': '2026-01-02T02:30:00.000Z',
             'dose': '1.5', 'unitName': '滴', 'amount': '1.5滴', 'notes': None}, owner, 'test_web_go_supplement')['data']
        records['supplement'] = identifier(supplement['id'])
        self.api('PATCH', catalog + '/' + pid, 200, {'baseVersion': product['version'], 'isArchived': True}, owner)
        timeline_path = f'/api/records/timeline?babyId={bid}&date=2026-01-02'
        timeline = self.bff('GET', timeline_path, 200, extended=True)
        assert {row['id'] for row in timeline} == set(records.values())
        by_id = {row['id']: row for row in timeline}
        assert by_id[rid]['rawRecord']['amountMl'] == 125 and by_id[rid]['rawRecord']['version'] == '2'
        assert by_id[records['sleep']]['rawRecord']['startTime'] == fixtures['sleep']['startedAt']
        raw = by_id[records['supplement']]['rawRecord']
        assert raw['productId'] == pid and raw['dose'] == 1.5 and raw['productName'] == 'test_historical_vitamin'
        assert all('version' not in row for row in self.bff('GET', timeline_path, 200))
        assert self.owned.sql(f"SELECT COUNT(*) FROM food_plans WHERE baby_id='{bid}';") == '0'
        self.passed('five-kind Go timeline, overnight sleep and archived canonical supplement without food-plan')

        caregiver_name = 'test_web_go_caregiver_' + self.owned.owner
        caregiver = self.api('POST', '/api/v1/auth/register', 201,
            {'username': caregiver_name, 'password': password, 'displayName': caregiver_name}, None)['data']
        caregiver_id = identifier(caregiver['user']['id'])
        invite = self.api('POST', f'/api/v1/families/{fid}/invites', 201, {'expiresInDays': 1}, owner)['data']['inviteCode']
        self.api('POST', '/api/v1/families/join', 200, {'inviteCode': invite}, caregiver['accessToken'])
        self.api('POST', f'/api/v1/babies/{bid}/members', 201, {'userId': caregiver_id, 'role': 'member'}, owner)
        caregiver_cookie, _ = self.login(caregiver_name, password)
        assert len(self.bff('GET', timeline_path, 200, cookie=caregiver_cookie)) == len(records)
        self.api('DELETE', f'/api/v1/babies/{bid}/members/{caregiver_id}', 200, token=owner)
        self.bff('GET', timeline_path, (403, 404), cookie=caregiver_cookie)
        self.passed('actual membership revocation denies an existing Web cookie')

        self.bff('DELETE', f'/api/records/feeding?babyId={bid}&id={rid}&baseVersion=2', 200, key='test_web_go_delete')
        self.api('GET', base + 'feeding/' + rid, 404, token=owner)
        assert rid not in {row['id'] for row in self.bff('GET', timeline_path, 200)}
        self.bff('POST', '/api/auth/logout', 200)
        assert self.bff('GET', '/api/auth/me', 200)['user'] is None
        self.report['httpCalls'] = self.calls
        self.passed('Web deletion reaches native storage and logout invalidates the BFF session')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-root', type=Path, required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    server_root, binary = args.server_root.resolve(), args.binary.resolve()
    baseline = json.loads(BASELINE.read_text())
    assert git(server_root, 'rev-parse', 'HEAD') == baseline['commit'], 'Native source is not the pinned reference'
    assert not git(server_root, 'status', '--porcelain'), 'Native source must be clean'
    version = json.loads(subprocess.run([str(binary), '--version'], check=True, capture_output=True, text=True).stdout)
    assert version['revision'] == baseline['commit'] and version['reference'] == baseline['referenceCommit']
    provenance = json.loads((ROOT / '.next/standalone/build-provenance.json').read_text())
    web_sha = git(ROOT, 'rev-parse', 'HEAD')
    assert provenance['sourceGitSha'] == web_sha and provenance['sourceDirty'] is False
    report = {'schemaVersion': 1, 'passed': False, 'webRevision': web_sha, 'serverRevision': baseline['commit'],
              'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'webBuild': provenance,
              'scope': 'real Next HTTP / native Go / isolated PostgreSQL and Redis; not browser, S3 or worker acceptance', 'cases': []}
    spec = importlib.util.spec_from_file_location('owned_native_web_tests', server_root / 'scripts/go-integration.py')
    assert spec and spec.loader
    tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tools)
    owned = tools.OwnedEnvironment()
    def interrupted(signum, frame):
        raise KeyboardInterrupt(f'test interrupted by signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        owned.start()
        native = owned.serve(binary)
        with tempfile.TemporaryDirectory(prefix='test_native_web_') as temp:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            assert port not in (3088, 3089, 5432, 6379)
            web = f'http://127.0.0.1:{port}'
            env = {k: v for k, v in owned.env.items() if not k.startswith(('AI_', 'OPENAI_', 'OPENROUTER_', 'ANTHROPIC_', 'VAPID_', 'PUSH_', 'ASR_'))}
            env.update(NODE_ENV='production', HOSTNAME='127.0.0.1', PORT=str(port),
                GROWDESK_ENABLED='1', GROWDESK_BACKEND='go', GROWDESK_API_URL='', GROWDESK_GO_API_URL=native,
                GROWDESK_WEB_ORIGIN=web, DATABASE_URL='file:' + str(Path(temp) / 'dev_test.db'),
                JWT_SECRET=secrets.token_hex(32), TRUST_PROXY='false', OPENROUTER_API_KEY='', AI_API_KEY='',
                AI_BASE_URL='http://127.0.0.1:1', OPENAI_API_KEY='', ASR_COMMAND='')
            log = tempfile.TemporaryFile(mode='w+t'); owned.files.append(log)
            proc = subprocess.Popen(['node', str(ROOT / '.next/standalone/server.js')], cwd=ROOT / '.next/standalone', env=env, stdout=log, stderr=log)
            owned.processes.append(proc)
            for _ in range(100):
                if proc.poll() is not None: raise RuntimeError('Next standalone exited before readiness')
                try:
                    status, value, _ = request_json(web, 'GET', '/api/auth/me')
                    if status == 200 and value.get('user') is None: break
                except OSError: pass
                time.sleep(.1)
            else: raise RuntimeError('Next standalone readiness timed out')
            Scenario(owned, native, web, report).run()
            report['passed'] = True
    except BaseException as error:
        report['errorType'] = type(error).__name__
        raise
    finally:
        owned.close()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Exercise the actual Next standalone BFF against a pinned native Go server.

Owns temporary PostgreSQL/Redis containers via the backend's test harness. No
external endpoint, credentials, existing database or production port is accepted.
This is HTTP and database acceptance for the listed flows, not browser UI E2E.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

BACKEND_COMMIT = '3e0578ba5e7ba6dc4b00e04d931385bbc5fafddb'
WEB_ROOT = Path(__file__).resolve().parents[2]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class WebRequests:
    def __init__(self, base: str):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.observations = []

    def call(self, method, path, expected, body=None, cookie=None, origin=True, key=None, extended=False, extra_headers=None):
        headers = {'Accept': 'application/json', **(extra_headers or {})}
        if cookie:
            headers['Cookie'] = cookie
        if origin:
            headers['Origin'] = self.base if origin is True else origin
        if key:
            headers['Idempotency-Key'] = key
        if extended:
            headers['x-growdesk-representation'] = 'extended'
        raw = None if body is None else json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
        if raw is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=raw, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            code = response.status
            data = json.loads(response.read(4 * 1024 * 1024))
            response_headers = response.headers
        # Do not write tokens, request bodies or private response data to reports.
        self.observations.append({'method': method, 'path': path.split('?', 1)[0], 'status': code, 'expectedStatus': expected})
        if code != expected:
            error = data.get('error', {}) if isinstance(data, dict) else {}
            safe_code = error.get('code', 'legacy_error') if isinstance(error, dict) else 'legacy_error'
            raise AssertionError(f'{method} {path.split("?", 1)[0]} expected {expected}, received {code} ({safe_code})')
        return data, response_headers

    def login(self, username, password):
        result, headers = self.call('POST', '/api/auth/login', 200, {'username': username, 'password': password})
        cookies = headers.get_all('Set-Cookie') or []
        session = next((value for value in cookies if value.startswith('__Host-growdesk_web=')), None)
        assert session and 'httponly' in session.lower() and 'secure' in session.lower()
        assert 'accessToken' not in result and 'refreshToken' not in result
        return session.split(';', 1)[0], result


def start_web(owned):
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    if port in (3080, 3081, 3088, 3089):
        raise RuntimeError('Refusing a reserved application port')
    origin = f'http://127.0.0.1:{port}'
    log = tempfile.TemporaryFile(mode='w+t')
    owned.files.append(log)
    env = {**owned.env, 'NODE_ENV': 'production', 'HOSTNAME': '127.0.0.1', 'HOST': '127.0.0.1', 'PORT': str(port),
           'GROWDESK_ENABLED': 'true', 'GROWDESK_BACKEND': 'go', 'GROWDESK_API_URL': '',
           'GROWDESK_GO_API_URL': owned.native_base, 'GROWDESK_WEB_ORIGIN': origin,
           'DATABASE_URL': 'file:./test_native_web_must_not_be_used.db', 'NEXT_TELEMETRY_DISABLED': '1'}
    child = subprocess.Popen(['node', str(WEB_ROOT / '.next/standalone/server.js')], cwd=WEB_ROOT, env=env, stdout=log, stderr=log)
    owned.processes.append(child)
    requests = WebRequests(origin)
    for _ in range(150):
        if child.poll() is not None:
            raise RuntimeError('Standalone Next process exited before readiness')
        try:
            data, _ = requests.call('GET', '/api/auth/me', 200, origin=False)
            assert data.get('user') is None
            return requests, child
        except (OSError, ValueError):
            time.sleep(.1)
    raise RuntimeError('Standalone Next readiness timed out')


def checked_id(value):
    assert isinstance(value, str) and re.fullmatch(r'[a-f0-9-]{36}', value)
    return value


def main():
    if not __debug__:
        raise RuntimeError('Assertions are required; do not use python -O')
    parser = argparse.ArgumentParser()
    parser.add_argument('--backend-root', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    backend = args.backend_root.resolve()
    actual_backend = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=backend, text=True).strip()
    if actual_backend != BACKEND_COMMIT:
        raise RuntimeError('The real-Go test must use its reviewed, pinned backend commit')
    binary = backend / 'dist-go/growdesk-api'
    if not binary.is_file() or not (WEB_ROOT / '.next/standalone/server.js').is_file():
        raise RuntimeError('Build both the pinned Go API and current Next standalone first')
    spec = importlib.util.spec_from_file_location('owned_native_backend', backend / 'scripts/go-integration.py')
    assert spec and spec.loader
    tools = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tools)
    owned = tools.OwnedEnvironment()
    report = {
        'scope': 'actual Next HTTP -> Go API -> owned PostgreSQL/Redis; not full browser or backend acceptance',
        'webCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=WEB_ROOT, text=True).strip(),
        'backendCommit': actual_backend,
        'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
        'status': 'RUNNING', 'http': [], 'verified': [],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    def save():
        args.report.write_text(json.dumps(report, indent=2) + '\n')
    def interrupted(signum, _frame):
        raise KeyboardInterrupt(f'signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    save()
    try:
        owned.start()
        owned.native_base = owned.serve(binary)
        username = 'test_web_' + owned.owner
        password = 'test_password_' + secrets.token_hex(12)
        registered = tools.expect(owned.native_base, 'POST', '/api/v1/auth/register', 201, {
            'username': username, 'password': password, 'displayName': 'Test Web User', 'deviceLabel': 'test_native_web'})['data']
        token = registered['accessToken']
        uid = checked_id(registered['user']['id'])
        family = tools.expect(owned.native_base, 'GET', '/api/v1/families', 200, token=token)['data'][0]
        fid = checked_id(family['id'])
        baby = tools.expect(owned.native_base, 'POST', f'/api/v1/families/{fid}/babies', 201, {
            'name': 'Test Web Baby', 'birthDate': '2026-01-02', 'gender': 'girl'}, token)['data']
        bid = checked_id(baby['id'])
        web, child = start_web(owned)
        report['http'] = web.observations
        cookie, login = web.login(username, password)
        assert login['user']['id'] == uid and login['baby']['id'] == bid
        assert login['baby']['nickname'] == 'Test Web Baby'
        me, _ = web.call('GET', '/api/auth/me', 200, cookie=cookie)
        assert me['user']['id'] == uid
        selected, _ = web.call('GET', f'/api/baby?babyId={bid}', 200, cookie=cookie)
        assert selected['id'] == bid and selected['nickname'] == 'Test Web Baby'
        report['verified'].append('native BFF login, protected cookie, identity and original baby DTO')

        path = '/api/records/feeding'
        record = {'babyId': bid, 'type': 'mixed', 'timestamp': '2026-09-12T08:15:00.000Z',
                  'amountMl': 85, 'leftMinutes': 0, 'rightMinutes': 3, 'spitUp': False,
                  'notes': 'test original text', 'clientId': str(uuid.uuid4())}
        web.call('POST', path, 403, record, cookie, origin=False)
        web.call('POST', path, 403, record, cookie, origin='https://test_attacker.invalid')
        assert owned.sql(f"SELECT COUNT(*) FROM feeding_records WHERE baby_id='{bid}';") == '0'
        key = 'test_create_' + owned.owner
        created, _ = web.call('POST', path, 201, record, cookie, key=key)
        rid = checked_id(created['id'])
        assert created['type'] == 'mixed' and created['amountMl'] == 85 and created['spitUp'] is False
        assert created['version'] == '1'
        replayed, _ = web.call('POST', path, 201, record, cookie, key=key)
        assert replayed == created
        assert owned.sql(f"SELECT COUNT(*) FROM feeding_records WHERE baby_id='{bid}';") == '1'
        direct_path = f'/api/v1/babies/{bid}/records/feeding/{rid}'
        direct = tools.expect(owned.native_base, 'GET', direct_path, 200, token=token)['data']
        assert direct['amountMl'] == '85' and direct['occurredAt'] == record['timestamp']
        assert direct['notes'] == record['notes']
        read_path = f'{path}?babyId={bid}&id={rid}'
        legacy, _ = web.call('GET', read_path, 200, cookie=cookie)
        assert legacy['amountMl'] == 85 and legacy['timestamp'] == record['timestamp']
        assert 'version' not in legacy and 'baseVersion' not in legacy
        extended, _ = web.call('GET', read_path, 200, cookie=cookie, extended=True)
        assert extended['version'] == '1' and extended['baseVersion'] == '1'
        listing, _ = web.call('GET', f'{path}?babyId={bid}&date=2026-09-12', 200, cookie=cookie, extended=True)
        assert len(listing) == 1 and listing[0]['id'] == rid
        report['verified'].append('legacy write/read/list, explicit extended DTO, decimals, zero, false and idempotent replay')

        patch = {'babyId': bid, 'id': rid, 'baseVersion': '1', 'amountMl': 0, 'notes': None}
        updated, _ = web.call('PUT', path, 200, patch, cookie, key='test_update_' + owned.owner)
        assert updated['version'] == '2' and updated['amountMl'] == 0 and updated['notes'] is None
        web.call('PUT', path, 409, {**patch, 'amountMl': 99}, cookie, key='test_stale_' + owned.owner)
        assert tools.expect(owned.native_base, 'GET', direct_path, 200, token=token)['data']['amountMl'] == '0'
        owned.sql(f"UPDATE baby_members SET role='viewer' WHERE baby_id='{bid}' AND user_id='{uid}';")
        web.call('GET', read_path, 200, cookie=cookie)
        web.call('POST', path, 403, record, cookie, key='test_viewer_' + owned.owner)
        owned.sql(f"UPDATE baby_members SET role='admin' WHERE baby_id='{bid}' AND user_id='{uid}';")
        outsider_name = 'test_outsider_' + owned.owner
        tools.expect(owned.native_base, 'POST', '/api/v1/auth/register', 201, {
            'username': outsider_name, 'password': password, 'displayName': 'Test Outsider'})
        outside_cookie, _ = web.login(outsider_name, password)
        web.call('GET', read_path, 403, cookie=outside_cookie, extra_headers={'x-user-id': uid, 'x-family-id': fid})
        owned.sql(f"UPDATE baby_members SET status='revoked' WHERE baby_id='{bid}' AND user_id='{uid}';")
        web.call('GET', read_path, 403, cookie=cookie)
        owned.sql(f"UPDATE baby_members SET status='active' WHERE baby_id='{bid}' AND user_id='{uid}';")
        report['verified'].append('optimistic conflict, explicit null, viewer denial, cross-family denial and live revocation')

        deleted, _ = web.call('DELETE', f'{path}?babyId={bid}&id={rid}&baseVersion=2', 200, cookie=cookie, key='test_delete_' + owned.owner)
        assert deleted == {'success': True, 'id': rid}
        assert owned.sql(f"SELECT deleted_at IS NOT NULL FROM feeding_records WHERE id='{rid}';") == 't'
        tools.expect(owned.native_base, 'GET', direct_path, 404, token=token)
        notifications, _ = web.call('GET', '/api/notifications', 200, cookie=cookie)
        assert isinstance(notifications, list)
        web.call('GET', '/api/ai/jobs/test_unavailable', 501, cookie=cookie)
        web.call('GET', '/api/user/tokens', 501, cookie=cookie)
        web.call('POST', '/api/auth/logout', 200, cookie=cookie)
        logged_out, _ = web.call('GET', '/api/auth/me', 200, cookie=cookie)
        assert logged_out['user'] is None
        report['verified'].append('soft delete, notification read, unavailable-capability fence and native logout')
        assert child.poll() is None
        report['status'] = 'PASS'
        print(f"PASS {len(report['http'])} real Next/Go HTTP assertions with PostgreSQL state checks", flush=True)
    except BaseException as error:
        report['status'] = 'FAIL'
        report['failureType'] = type(error).__name__
        raise
    finally:
        owned.close()
        save()


if __name__ == '__main__':
    main()

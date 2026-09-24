#!/usr/bin/env python3
"""Extend (never replace) the pinned native HTTP suite with browser boundary tests."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import uuid

if not __debug__:
    raise RuntimeError('Optimized Python is forbidden')

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('native_web_base', ROOT / 'scripts/review/check-native-go-web.py')
assert SPEC and SPEC.loader
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)


class BoundaryScenario(BASE.Scenario):
    def run(self):
        super().run()  # Retain all six original HTTP/database scenarios.
        accounts = []
        for label in ('reader', 'other'):
            username = 'test_notification_' + label + '_' + self.owned.owner
            password = 'test_password_' + secrets.token_hex(16)
            account = self.api('POST', '/api/v1/auth/register', 201,
                {'username': username, 'password': password, 'displayName': username})['data']
            token = account['accessToken']
            uid = BASE.identifier(account['user']['id'])
            family = self.api('POST', '/api/v1/families', 201,
                {'name': 'test_family_notification_' + label, 'timeZone': 'Asia/Tokyo'}, token)['data']
            fid = BASE.identifier(family['id'])
            baby = self.api('POST', f'/api/v1/families/{fid}/babies', 201,
                {'name': 'test_baby_notification_' + label, 'birthDate': '2026-01-01', 'gender': 'girl'}, token)['data']
            bid = BASE.identifier(baby['id'])
            accounts.append({'username': username, 'password': password, 'userId': uid, 'familyId': fid, 'babyId': bid})

        fixtures = []
        for index, label in enumerate(('automatic', 'retry', 'foreign')):
            account = accounts[1 if label == 'foreign' else 0]
            nid = str(uuid.uuid4())
            title = 'test_notice_' + label + '_' + self.owned.owner
            data = json.dumps({'familyId': account['familyId'], 'babyId': account['babyId']})
            # Every value is generated here or validated as a canonical UUID.
            # This owned PostgreSQL instance has no production connection path.
            self.owned.sql(f"INSERT INTO notifications(id,user_id,event_key,title,body,data,created_at) VALUES "
                f"('{nid}','{account['userId']}','daily.test.{index}','{title}','test_body','{data}'::jsonb,NOW());")
            fixtures.append({'id': nid, 'title': title})

        with tempfile.TemporaryDirectory(prefix='test_notification_browser_') as directory:
            manifest = Path(directory) / 'manifest.json'
            result = Path(directory) / 'result.json'
            payload = {'version': 1, 'ownerPid': os.getpid(), 'web': self.web,
                'accounts': accounts, 'notifications': fixtures, 'result': str(result)}
            fd = os.open(manifest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(payload, stream)
            env = {key: os.environ[key] for key in ('PATH', 'HOME', 'PLAYWRIGHT_BROWSERS_PATH') if key in os.environ}
            env['TEST_NOTIFICATION_MANIFEST'] = str(manifest)
            subprocess.run(['node', str(ROOT / 'scripts/review/check-notification-browser.mjs')],
                cwd=ROOT, env=env, check=True, timeout=180)
            browser = json.loads(result.read_text())
            assert browser['passed'] is True
            for name in browser['cases']:
                self.passed(name)
            self.report['browser'] = browser

        for fixture in fixtures[:2]:
            assert self.owned.sql(f"SELECT read_at IS NOT NULL FROM notifications WHERE id='{fixture['id']}' AND user_id='{accounts[0]['userId']}';") == 't'
        self.passed('browser acknowledgements persisted in real Go PostgreSQL')
        self.report['scope'] = 'original real HTTP suite plus Chromium notification boundary checks; one intentional HTTP 503 interception; no S3, AI execution or push delivery acceptance'


# Compose the existing harness rather than weakening its source identity,
# database ownership, credential isolation or guaranteed cleanup checks.
BASE.Scenario = BoundaryScenario
if __name__ == '__main__':
    BASE.main()

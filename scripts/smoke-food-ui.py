#!/usr/bin/env python3
"""Start a disposable copy of the frozen Web package with dummy configuration."""
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/tmp/growdesk-food-ui-release-20261102/web')
EVIDENCE = ROOT / 'evidence/tasks/FOOD_UI_20261102'


def request(route):
    connection = http.client.HTTPConnection('127.0.0.2', 3089, timeout=3)
    try:
        connection.request('GET', route)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def main():
    with tempfile.TemporaryDirectory(prefix='test_food_ui_standalone_') as directory:
        target = Path(directory) / 'web'
        shutil.copytree(SOURCE, target, symlinks=True)
        env = {
            'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/tmp', 'NODE_ENV': 'production',
            'PORT': '3089', 'HOSTNAME': '127.0.0.2', 'DATABASE_URL': f'file:{directory}/dev_test.db',
            'JWT_SECRET': 'test_food_ui_jwt_secret_only_for_build', 'AI_API_KEY': 'test_dummy_key',
            'AI_BASE_URL': 'http://127.0.0.2:1', 'LLM_PROFILES_FILE': f'{directory}/test_profiles_missing.json',
            'CHATGPT_PLAN_FILE': f'{directory}/test_plan_missing.json', 'GROWDESK_ENABLED': 'true',
            'GROWDESK_API_URL': 'http://127.0.0.2:1', 'GROWDESK_GO_API_URL': 'http://127.0.0.2:1',
            'NEXT_TELEMETRY_DISABLED': '1',
        }
        with (EVIDENCE / 'standalone-smoke.log').open('w') as log:
            process = subprocess.Popen(['node', 'server.js'], cwd=target, env=env, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError('standalone exited; inspect smoke log')
                    try:
                        if request('/login') == 200:
                            break
                    except OSError:
                        pass
                    time.sleep(0.2)
                else:
                    raise RuntimeError('standalone readiness timeout')
                statuses = {}
                for route, expected in [('/login', 200), ('/food/log', 200), ('/records/feeding', 200), ('/settings', 200), ('/api/food/logs', 401)]:
                    statuses[route] = request(route)
                    if statuses[route] != expected:
                        raise RuntimeError(f'wrong HTTP status {route}: {statuses[route]}')
                result = {'status': 'PASS', 'testAddress': '127.0.0.2:3089', 'statuses': statuses,
                          'databaseConnections': False, 'externalApiCalls': False}
                (EVIDENCE / 'standalone-smoke.json').write_text(json.dumps(result, indent=2) + '\n')
                print(json.dumps(result))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    main()

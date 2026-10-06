"""Read-only public smoke check; never authenticates or writes household data."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://baby.zwang.fun'
STATUSES = {'/': 200, '/nutrition': 200, '/dashboard': 200, '/notifications': 200,
            '/family/passport': 200, '/api/records/trends?babyId=test_unauthenticated': 401,
            '/api/nutrition/analysis?babyId=test_unauthenticated': 401}
BUNDLES = {
    '/_next/static/chunks/app/(main)/page-0a28577e1a272069.js': 'e43d8fcf60d865d46d97f987494739ed9a3ce68e73d128cffb90084180749f41',
    '/_next/static/chunks/app/(main)/nutrition/page-20acf364ebcc8d5e.js': '836b743f6def9e40169952da1b7032cc1f6caacfce97bb15b9a9946c35fc3b01',
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def check(path):
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(BASE + urllib.parse.quote(path, safe='/?=&'),
                                     headers={'Cache-Control': 'no-cache'})
    try:
        response = opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        expected = STATUSES.get(path, 200)
        assert response.status == expected, f'public status mismatch: {path}'
        result = {'path': path, 'status': response.status}
        if path in BUNDLES:
            result['sha256'] = hashlib.sha256(response.read()).hexdigest()
            assert result['sha256'] == BUNDLES[path], f'public bundle differs from deployed artifact: {path}'
            result['matchesDeployedArtifact'] = True
        return result

with ThreadPoolExecutor(max_workers=4) as pool:
    observations = list(pool.map(check, [*STATUSES, *BUNDLES]))
print(json.dumps({'status': 'PASS', 'readOnly': True, 'authenticated': False,
                  'productionWrites': 0, 'checks': observations}, indent=2))

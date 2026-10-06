"""Activate the reviewed Web build only; keep API, worker, configuration and data intact."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import time
import urllib.request
import urllib.error
import uuid

ROOT = Path('/home/ubuntu/growdesk/web-nutrition-releases/20261006')
LIVE = Path('/home/ubuntu/Github/baby_panel_for_cecilia')
CANDIDATE = ROOT / 'source/.next'
ROLLBACK = ROOT / 'rollback'
REVISION = '5fa673c23c8886a097477e01cf200d5279f98348'
EXPECTED_ARTIFACT = 'a78a1955b06ca8ad2a6d00cbba5527ac3f92e7da14ec1b60e9fec3ef02036794'
RUNTIME = ('data/archive', 'public/uploads', 'backups', 'llm-profiles.json', '.data')
UNITS = ('baby-panel', 'growdesk-api', 'growdesk-notifications-worker')
receipt = {'phase': 'preflight', 'deployed': False, 'schemaChanged': False, 'apiChanged': False, 'noProductionTestData': True}

def save():
    (ROOT / 'deployment-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

def ctl(*args):
    return subprocess.run(['sudo', '-n', 'systemctl', *args], check=True, capture_output=True, text=True).stdout

def props(unit):
    return dict(line.split('=', 1) for line in ctl('show', '--property=ActiveState,MainPID,NRestarts', unit).splitlines() if '=' in line)

def metadata(path):
    stat = path.stat()
    return {'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns, 'mode': stat.st_mode & 0o777, 'uid': stat.st_uid, 'gid': stat.st_gid}

def digest(path):
    if path.is_file():
        return hashlib.sha256(path.read_bytes()).hexdigest()
    hash_ = hashlib.sha256()
    for file in sorted(path.rglob('*')):
        if file.is_file():
            hash_.update(str(file.relative_to(path)).encode() + b'\0' + file.read_bytes() + b'\0')
    return hash_.hexdigest()

def artifact_digest(standalone):
    """Match scripts/prepare-standalone.mjs, including public and reference data."""
    hash_ = hashlib.sha256()
    def directory(path, prefix):
        for child in sorted(path.iterdir(), key=lambda entry: entry.name):
            if child.is_symlink():
                continue
            label = prefix + '/' + child.name
            if child.is_dir():
                directory(child, label)
            elif child.is_file():
                hash_.update(label.encode() + b'\0' + child.read_bytes() + b'\0')
    directory(standalone / '.next/server', 'server')
    directory(standalone / '.next/static', 'static')
    hash_.update(b'server.js\0' + (standalone / 'server.js').read_bytes() + b'\0')
    if (standalone / 'public').exists():
        directory(standalone / 'public', 'public')
    directory(standalone / 'data', 'data')
    return hash_.hexdigest()

def remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)

def copy_runtime(source, target, fallback=None):
    result = {}
    for rel in RUNTIME:
        src, dst = source / rel, target / rel
        if not src.exists() and fallback is not None:
            src = fallback / rel
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        nonce = uuid.uuid4().hex
        staged = dst.with_name(dst.name + '.stage-' + nonce)
        backup = dst.with_name(dst.name + '.backup-' + nonce)
        installed = False
        try:
            if src.exists():
                shutil.copytree(src, staged, symlinks=True) if src.is_dir() else shutil.copy2(src, staged)
                assert digest(src) == digest(staged), 'runtime copy mismatch: ' + rel
            if dst.exists() or dst.is_symlink():
                dst.rename(backup)
            if staged.exists():
                staged.rename(dst)
            installed = True
            if dst.exists():
                result[rel] = digest(dst)
        finally:
            if not installed and backup.exists():
                remove(dst)
                backup.rename(dst)
            remove(staged)
            if installed:
                remove(backup)
    return result

def status(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3088' + path, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except OSError:
        return 0

def ready():
    for _ in range(30):
        if status('/nutrition') == 200:
            return
        time.sleep(1)
    raise RuntimeError('Web did not become ready')

save()
try:
    assert not ROLLBACK.exists(), 'release already activated'
    candidate_provenance = json.loads((CANDIDATE / 'standalone/build-provenance.json').read_text())
    assert candidate_provenance['sourceGitSha'] == REVISION and not candidate_provenance['sourceDirty']
    assert candidate_provenance['artifactSha256'] == EXPECTED_ARTIFACT, 'candidate differs from tested build'
    receipt['verifiedArtifactSha256'] = artifact_digest(CANDIDATE / 'standalone')
    assert receipt['verifiedArtifactSha256'] == EXPECTED_ARTIFACT, 'candidate artifact was modified after build'
    receipt['candidateProvenance'] = candidate_provenance
    receipt['beforeProvenance'] = json.loads((LIVE / '.next/standalone/build-provenance.json').read_text())
    assert receipt['beforeProvenance']['sourceGitSha'] == 'c366c6818887fb400d541dc679fc5c5b936392b0', 'deployed baseline changed'
    receipt['beforeServices'] = {unit: props(unit) for unit in UNITS}
    assert all(value['ActiveState'] == 'active' and int(value['MainPID']) > 0 for value in receipt['beforeServices'].values())
    configs = (LIVE / '.env', Path('/home/ubuntu/growdesk/api.env'))
    receipt['configurationMetadataBefore'] = {str(path): metadata(path) for path in configs}
    receipt['unchangedSourceNotifications'] = digest(LIVE / 'app/notifications/page.tsx')
    immutable = ('standalone/.next/server', 'standalone/.next/static', 'standalone/server.js')
    receipt['immutableBuildHashes'] = {rel: digest(CANDIDATE / rel) for rel in immutable}
    ROLLBACK.mkdir(mode=0o700)
    receipt['phase'] = 'switching'
    receipt['switchStarted'] = True
    save()
    ctl('stop', 'baby-panel')
    assert props('baby-panel')['MainPID'] == '0', 'Web stop failed'
    receipt['preservedRuntimeHashes'] = copy_runtime(LIVE / '.next/standalone', CANDIDATE / 'standalone', LIVE)
    (LIVE / '.next').rename(ROLLBACK / 'web-next')
    CANDIDATE.rename(LIVE / '.next')
    receipt['candidateInstalled'] = True
    save()
    ctl('start', 'baby-panel')
    ready()
    expected = {'/': 200, '/nutrition': 200, '/dashboard': 200, '/notifications': 200, '/family/passport': 200,
                '/api/records/trends?babyId=test_unauthenticated': 401, '/api/nutrition/analysis?babyId=test_unauthenticated': 401}
    receipt['localStatus'] = {path: status(path) for path in expected}
    assert receipt['localStatus'] == expected
    receipt['afterServices'] = {unit: props(unit) for unit in UNITS}
    assert all(value['ActiveState'] == 'active' and int(value['MainPID']) > 0 for value in receipt['afterServices'].values())
    for unit in ('growdesk-api', 'growdesk-notifications-worker'):
        assert receipt['afterServices'][unit] == receipt['beforeServices'][unit], 'unrelated service changed: ' + unit
    assert {str(path): metadata(path) for path in configs} == receipt['configurationMetadataBefore']
    assert digest(LIVE / 'app/notifications/page.tsx') == receipt['unchangedSourceNotifications']
    assert {rel: digest(LIVE / '.next' / rel) for rel in immutable} == receipt['immutableBuildHashes']
    assert json.loads((LIVE / '.next/standalone/build-provenance.json').read_text()) == candidate_provenance
    receipt.update(phase='deployed', deployed=True, rollbackDirectory=str(ROLLBACK), configurationUnchanged=True)
    save()
    print(json.dumps({'deployed': True, 'revision': REVISION, 'services': receipt['afterServices'], 'localStatus': receipt['localStatus']}))
except BaseException as error:
    receipt.update(deployed=False, failureClass=type(error).__name__, failureMessage=str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'operation failed')
    if receipt.get('switchStarted'):
        try:
            ctl('stop', 'baby-panel')
            assert props('baby-panel')['MainPID'] == '0'
            old = ROLLBACK / 'web-next'
            if old.exists():
                if receipt.get('candidateInstalled'):
                    try:
                        copy_runtime(LIVE / '.next/standalone', old / 'standalone')
                    except BaseException as runtime_error:
                        # Keep the candidate tree for recovery, but always restore the old build.
                        receipt['rollbackRuntimePreservationError'] = type(runtime_error).__name__
                    failed = ROOT / ('failed-web-next-' + uuid.uuid4().hex)
                    (LIVE / '.next').rename(failed)
                    receipt['failedCandidateDirectory'] = str(failed)
                old.rename(LIVE / '.next')
            ctl('start', 'baby-panel')
            ready()
            assert json.loads((LIVE / '.next/standalone/build-provenance.json').read_text()) == receipt['beforeProvenance']
            receipt['rolledBack'] = True
        except BaseException as rollback_error:
            receipt['rollbackError'] = type(rollback_error).__name__
    save()
    print(json.dumps({'deployed': False, 'failureClass': receipt['failureClass'], 'rolledBack': receipt.get('rolledBack', False)}))
    raise

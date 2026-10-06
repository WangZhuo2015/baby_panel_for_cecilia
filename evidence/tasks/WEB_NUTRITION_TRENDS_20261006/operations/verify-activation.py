"""Exercise the activation controller on temporary files and fake systemd only."""
import ast
import contextlib
import io
import json
from pathlib import Path
import tempfile

SCRIPT = Path(__file__).with_name('activate-web.py')
tree = ast.parse(SCRIPT.read_text())
split = next(i for i, node in enumerate(tree.body) if isinstance(node, ast.Expr)
             and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
             and node.value.func.id == 'save')
definitions = compile(ast.Module(body=tree.body[:split], type_ignores=[]), str(SCRIPT), 'exec')
controller = compile(ast.Module(body=tree.body[split:], type_ignores=[]), str(SCRIPT), 'exec')

def setup(root):
    ns = {}
    exec(definitions, ns)
    live, candidate = root / 'live', root / 'candidate'
    for standalone in (live / '.next/standalone', candidate / 'standalone'):
        for rel in ('.next/server/a.js', '.next/static/a.js', 'server.js', 'public/a.txt', 'data/reference.json'):
            file = standalone / rel
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(rel)
    provenance = {'sourceGitSha': ns['REVISION'], 'sourceDirty': False,
                  'artifactSha256': ns['artifact_digest'](candidate / 'standalone')}
    (candidate / 'standalone/build-provenance.json').write_text(json.dumps(provenance))
    baseline = {'sourceGitSha': 'c366c6818887fb400d541dc679fc5c5b936392b0'}
    (live / '.next/standalone/build-provenance.json').write_text(json.dumps(baseline))
    archive = live / '.next/standalone/data/archive/record.json'
    archive.parent.mkdir(parents=True)
    archive.write_text('preserved_runtime_record')
    notification = live / 'app/notifications/page.tsx'
    notification.parent.mkdir(parents=True)
    notification.write_text('existing_user_source')
    services = {unit: {'ActiveState': 'active', 'MainPID': str(10 + i), 'NRestarts': '0'}
                for i, unit in enumerate(ns['UNITS'])}
    calls = []
    def ctl(action, unit):
        assert action in ('stop', 'start') and unit == 'baby-panel'
        calls.append((action, unit))
        services[unit] = {'ActiveState': 'active' if action == 'start' else 'inactive',
                          'MainPID': '20' if action == 'start' else '0', 'NRestarts': '0'}
        return ''
    ns.update(ROOT=root, LIVE=live, CANDIDATE=candidate, ROLLBACK=root / 'rollback',
              EXPECTED_ARTIFACT=provenance['artifactSha256'], ctl=ctl,
              props=lambda unit: dict(services[unit]), metadata=lambda path: {'fixture': True},
              ready=lambda: None,
              status=lambda path: 401 if path.startswith('/api/') else 200)
    return ns, calls, archive

results = []
with tempfile.TemporaryDirectory(prefix='test_web_activation_') as temp:
    root = Path(temp)
    for mode in ('success', 'service_static_copy', 'tampered_artifact', 'rollback_copy_failure', 'changed_service_static_copy'):
        fixture = root / mode
        fixture.mkdir()
        ns, calls, archive = setup(fixture)
        if mode == 'tampered_artifact':
            (ns['CANDIDATE'] / 'standalone/public/a.txt').write_text('modified_after_build')
        if mode in ('service_static_copy', 'changed_service_static_copy'):
            original_ctl = ns['ctl']
            def service_copy(action, unit):
                result = original_ctl(action, unit)
                if action == 'start' and ns['receipt'].get('candidateInstalled') and (ns['LIVE'] / '.next/standalone/.next/static').exists():
                    static = ns['LIVE'] / '.next/standalone/.next/static'
                    duplicate = static / 'static'
                    duplicate.mkdir(exist_ok=True)
                    (duplicate / 'a.js').write_bytes((static / 'a.js').read_bytes())
                    if mode == 'changed_service_static_copy':
                        (duplicate / 'a.js').write_text('unapproved_asset')
                return result
            ns['ctl'] = service_copy
        if mode == 'rollback_copy_failure':
            original_copy = ns['copy_runtime']
            counter = [0]
            def copy_failure(*args, **kwargs):
                counter[0] += 1
                if counter[0] == 2:
                    raise OSError('injected runtime-copy failure')
                return original_copy(*args, **kwargs)
            ns['copy_runtime'] = copy_failure
            ns['status'] = lambda path: 500
        failed = False
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(controller, ns)
        except AssertionError:
            failed = True
        receipt = ns['receipt']
        if mode in ('success', 'service_static_copy'):
            assert not failed and receipt['deployed']
            assert archive.read_text() == 'preserved_runtime_record'
        elif mode == 'tampered_artifact':
            assert failed and not calls and not ns['ROLLBACK'].exists()
            assert archive.read_text() == 'preserved_runtime_record'
        else:
            assert failed and receipt['rolledBack']
            if mode == 'rollback_copy_failure':
                assert receipt['rollbackRuntimePreservationError'] == 'OSError'
            assert ns['props']('baby-panel')['ActiveState'] == 'active'
            assert archive.read_text() == 'preserved_runtime_record'
            assert Path(receipt['failedCandidateDirectory']).is_dir()
        results.append({'scenario': mode, 'status': 'PASS'})

    ns, _, _ = setup(root / 'runtime')
    source, target = root / 'missing-source', root / 'existing-target'
    source.mkdir()
    preserved = target / 'data/archive/record.json'
    preserved.parent.mkdir(parents=True)
    preserved.write_text('must_keep')
    ns['copy_runtime'](source, target)
    assert preserved.read_text() == 'must_keep'
    results.append({'scenario': 'missing_runtime_source_preserves_target', 'status': 'PASS'})

    (source / 'data/archive').mkdir(parents=True)
    (source / 'data/archive/new.json').write_text('new')
    original_copytree = ns['shutil'].copytree
    def fail_copy(*args, **kwargs):
        raise OSError('injected stage-copy failure')
    ns['shutil'].copytree = fail_copy
    try:
        try:
            ns['copy_runtime'](source, target)
            raise AssertionError('copy failure must propagate')
        except OSError:
            pass
        assert preserved.read_text() == 'must_keep'
    finally:
        ns['shutil'].copytree = original_copytree
    results.append({'scenario': 'stage_copy_failure_preserves_old_runtime', 'status': 'PASS'})

print(json.dumps({'status': 'PASS', 'productionAccess': False, 'scenarios': results}, indent=2))

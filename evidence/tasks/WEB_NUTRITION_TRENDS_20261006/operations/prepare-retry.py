"""Recover a pristine tested candidate without changing the running Web tree."""
from pathlib import Path
import json
import shutil

ROOT = Path('/home/ubuntu/growdesk/web-nutrition-releases/20261006')
RETRY = Path('/home/ubuntu/growdesk/web-nutrition-releases/20261006-retry')
receipt = json.loads((ROOT / 'deployment-receipt.json').read_text())
assert receipt.get('rolledBack') is True and not receipt.get('deployed')
failed = Path(receipt['failedCandidateDirectory'])
assert failed.parent == ROOT and failed.name.startswith('failed-web-next-') and failed.is_dir()
assert not RETRY.exists(), 'retry directory already exists; refuse replacement'

def ignore(directory, names):
    relative = Path(directory).relative_to(failed).parts
    ignored = {
        ('standalone',): {'backups', 'llm-profiles.json', '.data'},
        ('standalone', 'data'): {'archive'},
        ('standalone', 'public'): {'uploads'},
        ('standalone', '.next', 'static'): {'static'},
    }.get(relative, set())
    return set(names) & ignored

RETRY.mkdir(mode=0o700)
candidate = RETRY / 'source/.next'
candidate.parent.mkdir()
shutil.copytree(failed, candidate, ignore=ignore, symlinks=True)
# The frozen build includes empty tracked upload-directory placeholders. Restore
# these public source assets without copying any production uploads.
for rel in ('public/uploads/medical/.gitkeep', 'public/uploads/avatars/.gitkeep'):
    source = ROOT / 'source' / rel
    assert source.read_bytes() == b''
    target = candidate / 'standalone' / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
print(json.dumps({'candidatePrepared': True, 'sourceRevision': '5fa673c23c8886a097477e01cf200d5279f98348',
                  'retainedFailedTree': str(failed), 'candidate': str(candidate)}))

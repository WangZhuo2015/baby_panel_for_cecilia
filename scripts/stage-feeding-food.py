#!/usr/bin/env python3
"""Stage only pinned public source plus this task's UI delta; never copy runtime data."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS = Path('/tmp/growdesk-openai-defaults-web-20261030')
MANIFESTS = Path('/home/ubuntu/Github/growdesk-server/evidence/tasks/OPENAI_OFFICIAL_API_20261030')
OUT = Path('/tmp/growdesk-feeding-food-web-20261102')
EVIDENCE = ROOT / 'evidence/tasks/FEEDING_FOOD_20261102'
DONORS = [
    'components/records/FeedingFormFields.tsx',
    'components/records/FoodLogForm.tsx',
    'components/records/WheelSpinnerColumn.tsx',
    'lib/food-options.ts',
    'lib/food-log-limits.ts',
    'lib/growdesk/food-compat.ts',
    'types/index.ts',
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if OUT.exists():
        raise RuntimeError('candidate already exists; preserving it')
    source = json.loads((MANIFESTS / 'web-source-baseline.json').read_text())['sourceFiles']
    source.update(json.loads((MANIFESTS / 'web-official-donors.json').read_text()))
    source.update(json.loads((MANIFESTS / 'web-recovered-compiled-sources.json').read_text()))
    for relative, expected in source.items():
        path = PurePosixPath(relative)
        if path.is_absolute() or '..' in path.parts or any(part.startswith('.env') or part in {
            '.gpt', '.data', 'uploads', 'backups', 'node_modules', '.next', '.git',
        } for part in path.parts):
            raise RuntimeError('unsafe source path')
        item = PREVIOUS / relative
        if item.is_symlink() or not item.is_file() or sha(item) != expected:
            raise RuntimeError('previous public source changed: ' + relative)
    OUT.mkdir()
    for relative in source:
        destination = OUT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(PREVIOUS / relative, destination)
    donors = {}
    for relative in DONORS:
        donor = ROOT / relative
        if donor.is_symlink() or not donor.is_file():
            raise RuntimeError('missing or linked donor: ' + relative)
        destination = OUT / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(donor, destination)
        donors[relative] = sha(donor)
    # Build with webpack: dependencies remain outside source and never contain
    # runtime .env/profile/database copies. Next traces required packages only.
    (OUT / 'node_modules').symlink_to(PREVIOUS / 'node_modules', target_is_directory=True)
    (OUT / 'generated').symlink_to(PREVIOUS / 'generated', target_is_directory=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / 'source-manifest.json').write_text(json.dumps({
        'task': 'FEEDING_FOOD_20261102', 'baseline': str(PREVIOUS), 'candidate': str(OUT),
        'baselineFiles': source, 'donors': donors, 'sourceFiles': {**source, **donors},
        'privateRuntimeFilesCopied': False, 'databaseMigrations': False,
    }, indent=2) + '\n')
    print(json.dumps({'candidate': str(OUT), 'baselineFiles': len(source), 'donors': len(donors)}))


if __name__ == '__main__':
    main()

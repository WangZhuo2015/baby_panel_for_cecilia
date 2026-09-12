"""Reproduce SH-00 route/method coverage; does not validate semantic columns."""
import csv,json,re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
known={'GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'}
expected=set()
for file in sorted((root/'app').rglob('route.ts')):
    source=file.read_text()
    methods=set(re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b',source))
    methods.update(re.findall(r'export\s+(?:const|let)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b',source))
    for group in re.findall(r'export\s*\{([^}]+)\}',source):
        for member in group.split(','):
            name=member.strip().split(' as ')[-1].strip()
            if name in known:methods.add(name)
    path='/'+file.parent.relative_to(root/'app').as_posix()
    expected.update((method,path,file.relative_to(root).as_posix()) for method in methods)
rows=list(csv.DictReader((root/'docs/compat/web-call-inventory.csv').open()))
actual={(r['method'],r['path'],r['route_file']) for r in rows}
result={'routeFiles':len(list((root/'app').rglob('route.ts'))),'sourceEndpoints':len(expected),'csvRows':len(rows),'missing':sorted(expected-actual),'extra':sorted(actual-expected),'duplicateRows':len(rows)-len(actual),'semanticColumnsValidated':False}
print(json.dumps(result,indent=2))
raise SystemExit(bool(result['missing'] or result['extra'] or result['duplicateRows']))

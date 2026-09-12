import csv
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]

# Load schema models
schema_text = (root / "prisma/schema.prisma").read_text(encoding="utf-8")
actual_models = set(re.findall(r"^model\s+([A-Za-z0-9_]+)\s+\{", schema_text, re.MULTILINE))
actual_models_lower = {m.lower(): m for m in actual_models}

# Read CSV
csv_rows = list(csv.DictReader((root / "docs/compat/web-call-inventory.csv").open(encoding="utf-8")))

errors = []

# 1. Total row count
if len(csv_rows) != 128:
    errors.append(f"Expected 128 CSV rows, got {len(csv_rows)}")

# 2. Check MCP auth & side effects
for r in csv_rows:
    if r["path"] in ("/api/mcp", "/mcp"):
        if r["method"] in ("GET", "POST", "DELETE"):
            if "OAuth" not in r["auth_type"] or "Bearer" not in r["auth_type"]:
                errors.append(f"{r['method']} {r['path']} expected Bearer OAuth auth_type, got {r['auth_type']}")
        if r["method"] == "OPTIONS":
            if r["side_effects"] != "none":
                errors.append(f"OPTIONS {r['path']} expected side_effects=none, got {r['side_effects']}")

    # Check OPTIONS side effects everywhere
    if r["method"] == "OPTIONS" and r["side_effects"] != "none":
        errors.append(f"OPTIONS {r['path']} should have no side effects, got {r['side_effects']}")

    # Check proposed operationId
    if not r["target_operation_id"].startswith("PROPOSED:"):
        errors.append(f"Row {r['method']} {r['path']} target_operation_id should start with PROPOSED:, got {r['target_operation_id']}")

    # Check DB models match actual prisma models
    for col in ["db_read_models", "db_write_models"]:
        val = r[col]
        if val and val != "none":
            for model_name in val.split(";"):
                # camelCase or lowercase model name
                if model_name.lower() not in actual_models_lower:
                    errors.append(f"Row {r['method']} {r['path']} references non-existent Prisma model '{model_name}' in {col}")

# 3. Check callers include stores/slices
stores_callers = [r for r in csv_rows if "stores/slices" in r["callers"]]
if len(stores_callers) < 15:
    errors.append(f"Expected at least 15 rows with stores/slices callers, got {len(stores_callers)}")

# 4. Check /api/baby reads
baby_get = [r for r in csv_rows if r["path"] == "/api/baby" and r["method"] == "GET"]
if not baby_get or "baby" not in baby_get[0]["db_read_models"] or "familyMember" not in baby_get[0]["db_read_models"]:
    errors.append(f"/api/baby GET should include baby and familyMember in db_read_models, got {baby_get[0]['db_read_models'] if baby_get else 'None'}")

if errors:
    print(f"FAILED: {len(errors)} semantic validation errors:")
    for e in errors:
        print(f"  - {e}")
    raise SystemExit(1)
else:
    print("SUCCESS: All SH-00 inventory semantic checks passed!")
    print(f"  - Verified {len(csv_rows)} rows")
    print(f"  - Verified MCP Bearer OAuth and OPTIONS neutrality")
    print(f"  - Verified stores/slices callers integration ({len(stores_callers)} endpoints)")
    print(f"  - Verified all Prisma models against schema.prisma ({len(actual_models)} actual models)")
    print(f"  - Verified all target_operation_ids prefixed with PROPOSED:")

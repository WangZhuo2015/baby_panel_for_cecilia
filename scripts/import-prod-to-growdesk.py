#!/usr/bin/env python3
"""Read-only preflight for an explicitly supplied, consistent SQLite snapshot.

The previous entry point automatically truncated the target database, assigned
care rows to the first family, and then overwrote local BFF stores. It is NOT a
safe production migration. That implementation remains in Git history and the
original development branch; it is intentionally not callable from this entry
point. This command never starts Docker, emits executable SQL, reads secrets,
connects to PostgreSQL, or writes a database or BFF store.

Usage: python3 scripts/import-prod-to-growdesk.py --snapshot test_snapshot.db --check-only
A passing preflight checks only source references, not field fidelity, target
reconciliation, attachment migration, cutover readiness or rollback safety.
"""

import argparse
import json
from pathlib import Path
import sqlite3
import sys


CORE_TABLES = ("User", "Family", "Baby", "FamilyMember")
CARE_TABLES = ("FeedingRecord", "SleepRecord", "DiaperRecord", "FoodLogRecord",
               "GrowthMeasurement", "SupplementRecord", "MedicalReport", "VaccineRecord")


def inspect_snapshot(path):
    source = Path(path).resolve(strict=True)
    if not source.is_file() or source.name in {"prod.db", "dev.db"}:
        raise ValueError("Use a separate consistent snapshot, not a live application database")
    connection = sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("BEGIN")
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = CORE_TABLES + CARE_TABLES
        missing = sorted(set(required) - names)
        if missing:
            return {"passed": False, "scope": "source_reference_preflight_only",
                    "executionAllowed": False, "readyForCutover": False,
                    "issues": [{"code": "MISSING_SOURCE_TABLES", "tables": missing}]}

        counts = {table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                  for table in required}
        users = {row[0] for row in connection.execute('SELECT id FROM "User"')}
        families = {row[0] for row in connection.execute('SELECT id FROM "Family"')}
        babies = {row["id"]: row["familyId"] for row in connection.execute('SELECT id, familyId FROM "Baby"')}
        issues = []
        if not users or not families or not babies:
            issues.append({"code": "EMPTY_IDENTITY_SOURCE"})
        orphan_babies = sum(family_id not in families for family_id in babies.values())
        if orphan_babies:
            issues.append({"code": "BABY_WITHOUT_FAMILY", "count": orphan_babies})
        orphan_members = sum(row["familyId"] not in families or row["userId"] not in users
                             for row in connection.execute('SELECT familyId, userId FROM "FamilyMember"'))
        if orphan_members:
            issues.append({"code": "ORPHAN_FAMILY_MEMBERS", "count": orphan_members})
        for table in CARE_TABLES:
            orphan_records = sum(row[0] not in babies for row in connection.execute(f'SELECT babyId FROM "{table}"'))
            if orphan_records:
                issues.append({"code": "RECORD_WITHOUT_BABY", "table": table, "count": orphan_records})
        # Do not silently turn a multi-tenant source into one household. A new
        # typed ETL must explicitly derive each record's family through Baby.
        if len(families) != 1:
            issues.append({"code": "MULTI_FAMILY_REQUIRES_SCOPED_ETL", "count": len(families)})
        return {"passed": not issues, "scope": "source_reference_preflight_only",
                "executionAllowed": False, "readyForCutover": False,
                "counts": counts, "issues": issues}
    finally:
        connection.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--check-only", required=True, action="store_true",
                        help="Required acknowledgement: this is a read-only preflight, not an import")
    args = parser.parse_args(argv)
    try:
        report = inspect_snapshot(args.snapshot)
    except (OSError, ValueError, sqlite3.Error):
        print("Cannot inspect a valid isolated source snapshot. No target was contacted or modified.", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

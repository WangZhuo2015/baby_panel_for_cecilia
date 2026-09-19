#!/usr/bin/env python3
"""Retired GrowDesk E2E entry point.

This module intentionally contains no imports or executable integration logic.
"""

raise SystemExit(
    "[RETIRED][FAIL-CLOSED] scripts/test-growdesk-e2e-all.py is disabled.\n"
    "The former runner used a real account and baby and mutated their records.\n"
    "This entry point exits before any network access or external dependency import.\n"
    "Use the isolated E2E flow documented in "
    "docs/plan/implementation/03_DATABASE_MIGRATION.md:\n"
    "  npm run test:e2e\n"
    "  # or: bash scripts/test-e2e.sh 3089\n"
    "That flow uses dev_test.db and test_/e2e_ tenants.\n"
    "A replacement GrowDesk integration runner is not implemented here."
)

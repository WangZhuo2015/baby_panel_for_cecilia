#!/usr/bin/env python3
"""Compare complete, explicitly exported legacy/GrowDesk API response snapshots.

This replaces the unsafe live-production probe. It never logs in, rewrites
Secure cookies, contacts a server, or modifies either database. Supply two JSON
objects keyed by endpoint; each value must contain {"status": 200, "body": ...}.
Use exports from isolated test tenants. This is a payload comparator, NOT proof
of a production cutover, live authorization, or completeness of an export.

All fields are compared unless --ignore-field is explicitly supplied. Every
record and nested value is checked; display truncation never changes exit
status. Diagnostics contain paths/reasons, never sensitive field values.
"""

import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys


def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object key")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("Non-finite JSON number")


def load_snapshot(path):
    with Path(path).open("r", encoding="utf-8") as stream:
        data = json.load(stream, parse_float=Decimal,
                         parse_constant=reject_constant,
                         object_pairs_hook=strict_object)
    if not isinstance(data, dict) or not data:
        raise ValueError("Snapshot must be a non-empty endpoint object")
    return data


def pointer(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def is_number(value):
    return not isinstance(value, bool) and isinstance(value, (int, Decimal))


def differences(left, right, path, ignored, id_key):
    """Yield ALL differences, with exact numeric and missing-vs-null semantics."""
    if is_number(left) and is_number(right):
        if left != right:
            yield {"path": path, "reason": "numeric_value_mismatch"}
        return
    if type(left) is not type(right):
        yield {"path": path, "reason": "type_mismatch"}
        return
    if isinstance(left, dict):
        for key in sorted(set(left) | set(right)):
            if key in ignored:
                continue
            child = f"{path}/{pointer(key)}"
            if key not in left or key not in right:
                yield {"path": child, "reason": "missing_field"}
            else:
                yield from differences(left[key], right[key], child, ignored, id_key)
        return
    if isinstance(left, list):
        if len(left) != len(right):
            yield {"path": path, "reason": "list_length_mismatch"}
        combined = left + right
        # Entity arrays are compared by ID, not incidental response ordering.
        # Ordinary scalar/anonymous arrays retain their meaningful order.
        has_ids = any(isinstance(item, dict) and id_key in item for item in combined)
        if has_ids:
            maps = []
            for side, values in (("legacy", left), ("growdesk", right)):
                mapped = {}
                valid = True
                for index, item in enumerate(values):
                    identifier = item.get(id_key) if isinstance(item, dict) else None
                    if not isinstance(identifier, str) or not identifier or identifier in mapped:
                        yield {"path": f"{path}/{index}", "reason": f"{side}_missing_or_duplicate_id"}
                        valid = False
                    else:
                        mapped[identifier] = item
                maps.append(mapped if valid else None)
            if any(item is None for item in maps):
                return
            first, second = maps
            for identifier in sorted(set(first) | set(second)):
                child = f"{path}/{pointer(identifier)}"
                if identifier not in first or identifier not in second:
                    yield {"path": child, "reason": "missing_record"}
                else:
                    yield from differences(first[identifier], second[identifier], child, ignored, id_key)
        else:
            for index, (a, b) in enumerate(zip(left, right)):
                yield from differences(a, b, f"{path}/{index}", ignored, id_key)
        return
    if left != right:
        yield {"path": path, "reason": "value_mismatch"}


def compare_snapshots(legacy, growdesk, ignored=(), id_key="id", max_details=50):
    outcomes = []
    ignored = frozenset(ignored)
    for endpoint in sorted(set(legacy) | set(growdesk)):
        result = {"endpoint": endpoint, "status": "FAIL", "differenceCount": 0, "differences": []}
        if endpoint not in legacy or endpoint not in growdesk:
            result["reason"] = "missing_endpoint"
            outcomes.append(result)
            continue
        left, right = legacy[endpoint], growdesk[endpoint]
        valid = True
        for response in (left, right):
            if (not isinstance(response, dict) or type(response.get("status")) is not int
                    or "body" not in response):
                valid = False
        if not valid:
            result["reason"] = "invalid_response_envelope"
        elif not (200 <= left["status"] < 300 and 200 <= right["status"] < 300):
            # Two identical 401/500 errors must never count as successful parity.
            result["reason"] = "non_success_http_status"
        elif left["status"] != right["status"]:
            result["reason"] = "http_status_mismatch"
        else:
            for item in differences(left["body"], right["body"], "", ignored, id_key):
                result["differenceCount"] += 1
                if len(result["differences"]) < max_details:
                    result["differences"].append(item)
            result["status"] = "PASS" if result["differenceCount"] == 0 else "DIFF"
        outcomes.append(result)
    passed = bool(outcomes) and all(item["status"] == "PASS" for item in outcomes)
    return {"passed": passed, "scope": "exported_payloads_only", "ignoredFields": sorted(ignored),
            "endpoints": outcomes}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-json", required=True, type=Path)
    parser.add_argument("--growdesk-json", required=True, type=Path)
    parser.add_argument("--ignore-field", action="append", default=[],
                        help="Explicit field exclusion, applied recursively and recorded in the report")
    parser.add_argument("--id-key", default="id")
    parser.add_argument("--max-details", type=int, default=50,
                        help="Display limit only; all differences still affect pass/fail")
    args = parser.parse_args(argv)
    if args.max_details < 0 or not args.id_key:
        parser.error("max-details must be non-negative and id-key must be non-empty")
    try:
        legacy = load_snapshot(args.legacy_json)
        growdesk = load_snapshot(args.growdesk_json)
        report = compare_snapshots(legacy, growdesk, args.ignore_field, args.id_key, args.max_details)
    except (OSError, ValueError, TypeError):
        # Do not print raw response bodies, credentials, filesystem contents or
        # exception messages containing patient data from malformed exports.
        print("Cannot read valid snapshot JSON; no live server was contacted.", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

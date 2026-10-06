#!/usr/bin/env python3
"""Isolated HTTP acceptance for Web nutrition and care trends.

Builds a caller-pinned Go backend and this Web checkout, then starts both against
the backend suite's owner-labelled, loopback-only PostgreSQL/Redis containers.
The browser run is separate so it can use an SSH tunnel to this runner's Web
port. The optional fixture contains only disposable test_ credentials and is
mode 0600; it is removed during cleanup.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.cookies import SimpleCookie
from zoneinfo import ZoneInfo


FROZEN_BACKEND = "8b9edd3be223c2e784bf3ba617d7f11eac27323a"
WEB_ROOT = Path(__file__).resolve().parents[2]
MAX_RESPONSE = 4 * 1024 * 1024
RESERVED_PORTS = {3080, 3081, 3088, 3089, 5432, 6379}
SHANGHAI = ZoneInfo("Asia/Shanghai")
FORBIDDEN_PASSTHROUGH_PREFIXES = (
    "VAPID_", "PUSH_", "WEB_PUSH_", "SMTP_", "MAIL_", "EMAIL_", "TWILIO_",
    "STRIPE_", "BILLING_", "S3_", "OBJECT_STORAGE_",
)
NEXT_ENV_FILES = (
    ".env", ".env.local", ".env.production", ".env.production.local",
)
ALL_NUTRIENT_IDS = {
    "energy_kcal", "energy_kj", "protein", "fat", "carbohydrate", "dietary_fiber",
    "linoleic_acid", "alpha_linolenic_acid", "dha", "ara", "vitamin_a", "vitamin_d",
    "vitamin_e", "vitamin_k", "vitamin_b1", "vitamin_b2", "vitamin_b6", "vitamin_b12",
    "vitamin_c", "folate", "niacin", "pantothenic_acid", "biotin", "choline", "calcium",
    "phosphorus", "potassium", "sodium", "magnesium", "iron", "zinc", "copper",
    "manganese", "iodine", "selenium", "taurine", "nucleotides", "lutein",
}

if not __debug__:
    raise RuntimeError("Refusing optimized Python: acceptance assertions must remain enabled")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, newurl):
        return None


def atomic_json(path: Path, payload: dict, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp-" + secrets.token_hex(4))
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temp, mode)
    temp.replace(path)
    os.chmod(path, mode)


def safe_report(path: Path | None, report: dict) -> None:
    if path is None:
        return
    atomic_json(path, report, 0o600)


def git_revision(root: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def source_digest(root: Path) -> str:
    """Hash executable Go source, module locks, and migrations without .git."""
    names = []
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith((".git/", "vendor/")):
            continue
        if rel in {"go.mod", "go.sum"} or rel.endswith(".go") or (
            rel.endswith(".sql") and (rel.startswith("native/migrations/") or rel.startswith("prisma/migrations/"))
        ):
            names.append(rel)
    entries = [(name, hashlib.sha256((root / name).read_bytes()).hexdigest()) for name in sorted(names)]
    canonical = json.dumps(entries, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(canonical).hexdigest()


def require_local_docker() -> str:
    if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
        raise RuntimeError("remote_or_overridden_docker_context_rejected")
    result = subprocess.run(
        ["docker", "context", "inspect", "--format", "{{(index .Endpoints \"docker\").Host}}"],
        capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("docker_context_unavailable")
    target = result.stdout.strip()
    if target != "unix:///var/run/docker.sock":
        raise RuntimeError("docker_context_must_be_local_unix_socket")
    return "unix:///var/run/docker.sock"


def loopback_origin(raw: str, expected_port: int | None = None) -> str:
    parts = urllib.parse.urlsplit(raw)
    if (parts.scheme != "http" or parts.hostname != "127.0.0.1" or parts.username or parts.password
            or parts.path not in ("", "/") or parts.query or parts.fragment or not parts.port
            or parts.port in RESERVED_PORTS):
        raise RuntimeError("browser_origin_must_be_http_loopback_with_nonreserved_port")
    if expected_port is not None and parts.port != expected_port:
        raise RuntimeError("browser_origin_port_must_match_web_port")
    return f"http://127.0.0.1:{parts.port}"


def choose_port(requested: int) -> int:
    if requested:
        if requested < 1024 or requested > 65535 or requested in RESERVED_PORTS:
            raise RuntimeError("requested_web_port_is_reserved_or_invalid")
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            try:
                sock.bind(("127.0.0.1", requested))
            except OSError as error:
                raise RuntimeError("requested_web_port_is_in_use") from error
        return requested
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    if port in RESERVED_PORTS:
        return choose_port(0)
    return port


def request_json(base: str, method: str, path: str, body=None, headers=None):
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port or parsed.port in RESERVED_PORTS:
        raise RuntimeError("HTTP target must be a nonreserved loopback URL")
    if not path.startswith("/") or path.startswith("//"):
        raise RuntimeError("invalid_request_path")
    request_headers = {"Accept": "application/json", **(headers or {})}
    raw = None
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        request_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=raw, headers=request_headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(req, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw_response = response.read(MAX_RESPONSE + 1)
        if len(raw_response) > MAX_RESPONSE:
            raise AssertionError("oversized_http_response")
        if "application/json" not in response.headers.get("Content-Type", ""):
            raise AssertionError("expected_json_http_response")
        try:
            payload = json.loads(raw_response)
        except json.JSONDecodeError as error:
            raise AssertionError("invalid_json_http_response") from error
        return response.status, payload, response.headers


class HttpChecks:
    def __init__(self, base: str, report: dict):
        self.base = base
        self.report = report

    def call(self, method, path, expected, body=None, headers=None):
        status, value, response_headers = request_json(self.base, method, path, body, headers)
        allowed = (expected,) if isinstance(expected, int) else tuple(expected)
        code = None
        if isinstance(value, dict):
            err = value.get("error")
            if isinstance(err, dict):
                code = err.get("code")
        self.report["httpObservations"].append({
            "method": method, "path": path.split("?", 1)[0], "status": status,
            "expectedStatus": list(allowed), "errorCode": code,
        })
        if status not in allowed:
            raise AssertionError(f"{method} {path.split('?', 1)[0]} expected {allowed}, got {status}, code={code}")
        return value, response_headers


def owned_backend_tools(backend_root: Path):
    entry = backend_root / "scripts/go-integration.py"
    if not entry.is_file():
        raise RuntimeError("backend_root_missing_scripts/go-integration.py")
    spec = importlib.util.spec_from_file_location("nutrition_trends_owned_environment", entry)
    if spec is None or spec.loader is None:
        raise RuntimeError("could_not_load_backend_owned_environment")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sanitize_owned_environment(owned) -> None:
    for name in tuple(owned.env):
        if name.startswith(FORBIDDEN_PASSTHROUGH_PREFIXES):
            owned.env.pop(name, None)


def reject_next_env_files(web_root: Path) -> None:
    roots = (web_root, web_root / ".next/standalone")
    for root in roots:
        for name in NEXT_ENV_FILES:
            if (root / name).exists():
                raise RuntimeError("refusing_Next_env_file_that_may_contain_unapproved_secrets")


def build_backend(backend_root: Path, owned, out: Path, revision: str) -> tuple[Path, Path]:
    api = out / "growdesk-api"
    migrate = out / "growdesk-migrate"
    for target, package in ((api, "./cmd/growdesk-api"), (migrate, "./cmd/growdesk-migrate")):
        result = subprocess.run(
            ["go", "build", "-mod=readonly", "-trimpath", "-ldflags=-X main.revision=" + revision,
             "-o", str(target), package],
            cwd=backend_root, env=owned.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, timeout=300, check=False,
        )
        if result.returncode != 0:
            # Never echo tool output: a source build can include environment or paths.
            raise RuntimeError(f"backend_build_failed_{Path(package).name}_{result.returncode}")
    version = subprocess.run([str(api), "--version"], cwd=backend_root, env=owned.env,
                             capture_output=True, text=True, timeout=20, check=False)
    if version.returncode != 0:
        raise RuntimeError("built_backend_version_probe_failed")
    try:
        identity = json.loads(version.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("built_backend_version_probe_invalid") from error
    if identity.get("revision") != revision:
        raise RuntimeError("built_backend_revision_mismatch")
    return api, migrate


def build_web(web_root: Path, owned, out: Path, web_port: int, web_revision: str) -> None:
    if not (web_root / "package.json").is_file() or not (web_root / "node_modules/.bin/next").exists():
        raise RuntimeError("web_source_or_preinstalled_next_dependencies_missing")
    reject_next_env_files(web_root)
    origin = f"http://127.0.0.1:{web_port}"
    build_env = {
        **owned.env,
        "NODE_ENV": "production", "TZ": "Asia/Shanghai", "NEXT_TELEMETRY_DISABLED": "1",
        "PORT": str(web_port), "HOSTNAME": "127.0.0.1", "HOST": "127.0.0.1",
        "GROWDESK_ENABLED": "true", "GROWDESK_BACKEND": "go",
        "GROWDESK_GO_API_URL": "http://127.0.0.1:1", "GROWDESK_WEB_ORIGIN": origin,
        "DATABASE_URL": "file:" + str(out / "legacy-web-must-not-be-used.db"),
        "JWT_SECRET": "test_only_no_external_calls", "SESSION_ENCRYPTION_KEY": "test_only_no_external_calls",
        "INVITE_SECRET": "test_only_no_external_calls", "OPENAI_API_KEY": "test_virtual_no_billing",
        "ANTHROPIC_API_KEY": "test_virtual_no_billing", "GROWDESK_AI_PROVIDER": "fixture",
        "GROWDESK_AI_FIXTURE_RESPONSE": '{"text":"test_only","actions":[]}',
        "BUILD_REVISION": web_revision,
        "BUILD_SOURCE_DIRTY": "false",
        "S3_BUCKET": "test_nutrition_unused", "S3_ENDPOINT": "http://127.0.0.1:1",
        "S3_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "test_virtual_unused",
        "AWS_SECRET_ACCESS_KEY": "test_virtual_unused", "AWS_EC2_METADATA_DISABLED": "true",
    }
    result = subprocess.run(["npm", "run", "build"], cwd=web_root, env=build_env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            timeout=900, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"web_standalone_build_failed_exit_{result.returncode}")
    if not (web_root / ".next/standalone/server.js").is_file():
        raise RuntimeError("standalone_server_not_created")


def verify_standalone_artifact(web_root: Path, expected_revision: str | None) -> dict:
    provenance_path = web_root / ".next/standalone/build-provenance.json"
    if not provenance_path.is_file():
        raise RuntimeError("standalone_build_provenance_missing")
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as error:
        raise RuntimeError("standalone_build_provenance_invalid") from error
    if not isinstance(expected_revision, str) or len(expected_revision) != 40:
        raise RuntimeError("full_web_revision_required_for_build_provenance")
    if provenance.get("sourceGitSha") != expected_revision or provenance.get("sourceDirty") is not False:
        raise RuntimeError("standalone_build_source_revision_or_dirty_state_mismatch")

    standalone = web_root / ".next/standalone"
    digest = hashlib.sha256()

    def hash_directory(directory: Path, prefix: str) -> None:
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            if path.is_symlink():
                continue
            label = prefix + "/" + path.name
            if path.is_dir():
                hash_directory(path, label)
            elif path.is_file():
                digest.update(label.encode())
                digest.update(b"\0")
                digest.update(path.read_bytes())
                digest.update(b"\0")

    server = standalone / ".next/server"
    static = standalone / ".next/static"
    data = standalone / "data"
    for required in (standalone / "server.js", server, static, data):
        if not required.exists():
            raise RuntimeError("standalone_artifact_incomplete")
    hash_directory(server, "server")
    hash_directory(static, "static")
    digest.update(b"server.js\0")
    digest.update((standalone / "server.js").read_bytes())
    digest.update(b"\0")
    if (standalone / "public").exists():
        hash_directory(standalone / "public", "public")
    hash_directory(data, "data")
    if digest.hexdigest() != provenance.get("artifactSha256"):
        raise RuntimeError("standalone_artifact_hash_mismatch")
    return {key: provenance.get(key) for key in ("sourceGitSha", "sourceDirty", "buildId", "artifactSha256", "builtAt")}


def start_web(owned, web_root: Path, web_port: int, browser_origin: str, private: Path,
              virtual_key: str) -> tuple[str, subprocess.Popen, object]:
    reject_next_env_files(web_root)
    base = f"http://127.0.0.1:{web_port}"
    log = tempfile.TemporaryFile(mode="w+t")
    owned.files.append(log)
    env = {
        **owned.env,
        "NODE_ENV": "production", "TZ": "Asia/Shanghai", "NEXT_TELEMETRY_DISABLED": "1",
        "HOSTNAME": "127.0.0.1", "HOST": "127.0.0.1", "PORT": str(web_port),
        "GROWDESK_ENABLED": "true", "GROWDESK_BACKEND": "go",
        "GROWDESK_GO_API_URL": owned.native_base, "GROWDESK_WEB_ORIGIN": browser_origin,
        "DATABASE_URL": "file:" + str(private / "legacy-web-must-not-be-used.db"),
        "JWT_SECRET": owned.jwt, "SESSION_ENCRYPTION_KEY": owned.jwt,
        "INVITE_SECRET": secrets.token_hex(32), "OPENAI_API_KEY": virtual_key,
        "ANTHROPIC_API_KEY": virtual_key, "GROWDESK_AI_PROVIDER": "fixture",
        "GROWDESK_AI_FIXTURE_RESPONSE": '{"text":"test_only","actions":[]}',
        "S3_BUCKET": "test_nutrition_unused", "S3_ENDPOINT": "http://127.0.0.1:1",
        "S3_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "test_virtual_unused",
        "AWS_SECRET_ACCESS_KEY": "test_virtual_unused", "AWS_EC2_METADATA_DISABLED": "true",
    }
    process = subprocess.Popen(["node", str(web_root / ".next/standalone/server.js")], cwd=web_root,
                               env=env, stdout=log, stderr=log)
    owned.processes.append(process)
    for _ in range(150):
        if process.poll() is not None:
            raise RuntimeError("standalone_web_process_exited_before_readiness")
        try:
            status, payload, _ = request_json(base, "GET", "/api/auth/me")
            if status == 200 and isinstance(payload, dict) and payload.get("user") is None:
                return base, process, log
        except (OSError, AssertionError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError("standalone_web_readiness_timeout")


def bearer(token: str, extra=None) -> dict:
    return {"Authorization": "Bearer " + token, **(extra or {})}


def create_account(checks: HttpChecks, label: str, password: str) -> dict:
    username = "test_nutrition_trends_" + label + "_" + secrets.token_hex(5)
    value, _ = checks.call("POST", "/api/v1/auth/register", 201, {
        "username": username, "password": password, "displayName": "test_" + label,
        "deviceLabel": "test_nutrition_trends",
    })
    return {"username": username, "password": password, **value["data"]}


def create_family_and_baby(checks: HttpChecks, account: dict, family_suffix: str, baby_suffix: str) -> tuple[dict, dict]:
    family_tag = hashlib.sha256(family_suffix.encode()).hexdigest()[:6]
    baby_tag = hashlib.sha256(baby_suffix.encode()).hexdigest()[:6]
    family_result, _ = checks.call("POST", "/api/v1/families", 201,
        {"name": "test_family_" + family_tag, "timeZone": "Asia/Shanghai"},
        bearer(account["accessToken"]))
    family = family_result["data"]
    baby_result, _ = checks.call("POST", "/api/v1/families/" + family["id"] + "/babies", 201,
        {"name": "test_baby_" + baby_tag, "birthDate": "2025-01-02", "gender": "girl"},
        bearer(account["accessToken"]))
    return family, baby_result["data"]


def local_stamp(days_ago: int, hour: int = 9, minute: int = 15) -> dt.datetime:
    today = dt.datetime.now(SHANGHAI).date()
    date = today - dt.timedelta(days=days_ago)
    return dt.datetime.combine(date, dt.time(hour, minute), SHANGHAI)


def iso_local(stamp: dt.datetime) -> str:
    return stamp.isoformat(timespec="seconds")


def add_records(checks: HttpChecks, account: dict, family: dict, baby: dict, today: dt.date) -> dict:
    token = account["accessToken"]
    root = f"/api/v1/babies/{baby['id']}/records"
    feeding_offsets = [0, 1, 3, 6, 9, 17, 29]
    milk_values = [180, 150, 210, 120, 230, 190, 160]
    for index, (days_ago, amount) in enumerate(zip(feeding_offsets, milk_values)):
        checks.call("POST", root + "/feeding", 201, {
            "feedingType": "formula", "occurredAt": iso_local(local_stamp(days_ago)),
            "amountMl": str(amount), "spitUp": False,
        }, bearer(token, {"Idempotency-Key": f"test_nutrition_trends_feeding_{index}"}))

    for index, days_ago in enumerate((0, 2, 6, 15)):
        start = local_stamp(days_ago, 11, 0)
        checks.call("POST", root + "/sleep", 201, {
            "sleepType": "nap", "startedAt": iso_local(start),
            "endedAt": iso_local(start + dt.timedelta(minutes=45 + index * 10)),
        }, bearer(token, {"Idempotency-Key": f"test_nutrition_trends_sleep_{index}"}))

    for index, days_ago in enumerate((0, 1, 5, 16)):
        checks.call("POST", root + "/diaper", 201, {
            "diaperType": ("both" if index % 2 == 0 else "pee"),
            "occurredAt": iso_local(local_stamp(days_ago, 14, 0)),
            "poopColor": "yellow" if index % 2 == 0 else None,
        }, bearer(token, {"Idempotency-Key": f"test_nutrition_trends_diaper_{index}"}))

    food_offsets = (0, 3, 6, 20)
    for index, days_ago in enumerate(food_offsets):
        record_date = today - dt.timedelta(days=days_ago)
        checks.call("POST", root + "/food", 201, {
            "recordDate": record_date.isoformat(), "mealType": ("lunch" if index % 2 == 0 else "snack"),
            "occurredAt": iso_local(local_stamp(days_ago, 12, 15)), "foodItemIds": [],
            "portionDescription": "test_30g_puree", "notes": "test_nutrition_trend_fixture",
        }, bearer(token, {"Idempotency-Key": f"test_nutrition_trends_food_{index}"}))

    nutrient_values = {
        "vitamin_d": {"amount": 120, "unit": "IU"},
        "vitamin_a": {"amount": 40, "unit": "mcg RAE"},
        "calcium": {"amount": 70, "unit": "mg"},
        "iron": {"amount": 1.2, "unit": "mg"},
        "zinc": {"amount": 0.5, "unit": "mg"},
        "dha": {"amount": 4, "unit": "mg"},
        "energy_kcal": {"amount": 4, "unit": "kcal"},
        "protein": {"amount": 1, "unit": "g"},
    }
    catalog = f"/api/v1/families/{family['id']}/nutrition/supplement-products"
    product_result, _ = checks.call("POST", catalog, 201, {
        "name": "test_trend_vitamin", "dosageForm": "drops", "unitName": "滴",
        "defaultDose": "1", "nutrientsJson": nutrient_values,
    }, bearer(token))
    product = product_result["data"]
    for index, days_ago in enumerate((0, 3, 10, 29)):
        checks.call("POST", root + "/supplement", 201, {
            "supplementName": "test_trend_vitamin", "productId": product["id"],
            "occurredAt": iso_local(local_stamp(days_ago, 16, 30)), "dose": "1",
            "unitName": "滴", "amount": "1滴",
        }, bearer(token, {"Idempotency-Key": f"test_nutrition_trends_supplement_{index}"}))

    return {
        "feedingOffsets": feeding_offsets, "foodOffsets": list(food_offsets),
        "supplementOffsets": [0, 3, 10, 29], "babyId": baby["id"],
    }


def login(checks: HttpChecks, web_base: str, origin: str, account: dict) -> str:
    value, headers = checks.call("POST", "/api/auth/login", 200,
        {"username": account["username"], "password": account["password"]},
        {"Origin": origin})
    if "accessToken" in value or "refreshToken" in value:
        raise AssertionError("BFF login must not expose backend tokens")
    cookies = SimpleCookie()
    for raw in headers.get_all("Set-Cookie", []):
        cookies.load(raw)
    cookie = cookies.get("__Host-growdesk_web")
    if not cookie or not cookie["secure"] or not cookie["httponly"] or cookie["path"] != "/":
        raise AssertionError("expected protected production BFF session cookie")
    return f"{cookie.key}={cookie.value}"


def run_http_acceptance(native_base: str, web_base: str, origin: str, owned, report: dict,
                        fixture_path: Path, requested_web_port: int) -> None:
    native = HttpChecks(native_base, report)
    web = HttpChecks(web_base, report)
    owner = create_account(native, "owner", "Test_" + secrets.token_urlsafe(24) + "9aA!")
    outsider = create_account(native, "outsider", "Test_" + secrets.token_urlsafe(24) + "7bB!")
    family, baby = create_family_and_baby(native, owner, owned.owner, owned.owner)
    other_family, other_baby = create_family_and_baby(native, outsider, owned.owner + "_other", owned.owner + "_other")
    today = dt.datetime.now(SHANGHAI).date()
    fixture_data = add_records(native, owner, family, baby, today)
    owner_cookie = login(web, web_base, origin, owner)

    for days in (7, 30):
        path = f"/api/records/trends?babyId={baby['id']}&days={days}"
        trends, _ = web.call("GET", path, 200, headers={"Cookie": owner_cookie})
        if trends.get("babyId") != baby["id"] or len(trends.get("days", [])) != days:
            raise AssertionError(f"care_trends_{days}d_scope_or_length_mismatch")
        first_date = today - dt.timedelta(days=days - 1)
        days_data = trends["days"]
        if days_data[0].get("date") != first_date.isoformat() or days_data[-1].get("date") != today.isoformat():
            raise AssertionError(f"care_trends_{days}d_date_window_mismatch")
        if not all(isinstance(row.get("foodCount"), int) for row in days_data):
            raise AssertionError("care_trends_foodCount_missing_or_noninteger")
        expected_food = sum(offset < days for offset in fixture_data["foodOffsets"])
        if sum(row["foodCount"] for row in days_data) != expected_food:
            raise AssertionError(f"care_trends_{days}d_food_count_mismatch")
        if sum((row.get("recordedMilkMl") or 0) for row in days_data) <= 0:
            raise AssertionError(f"care_trends_{days}d_milk_empty")
        observed_milk = [row["recordedMilkMl"] for row in days_data if row.get("recordedMilkMl") is not None]
        if len(observed_milk) < 3 or len(set(observed_milk)) < 2:
            raise AssertionError(f"care_trends_{days}d_milk_not_a_real_varying_series")
        report["checks"].append(f"records/trends {days}d includes real milk, sleep, diaper, foodCount series")

        analysis_path = f"/api/nutrition/analysis?babyId={baby['id']}&date={today.isoformat()}&days={days}"
        analysis, _ = web.call("GET", analysis_path, 200, headers={"Cookie": owner_cookie})
        summary = analysis.get("summary")
        if not isinstance(summary, dict) or len(summary.get("dailyTrends", [])) != days:
            raise AssertionError(f"nutrition_analysis_{days}d_summary_length_mismatch")
        if set(summary.get("averageIntakes", {})) != ALL_NUTRIENT_IDS:
            raise AssertionError(f"nutrition_analysis_{days}d_average_intake_metric_set_incomplete")
        for day in summary["dailyTrends"]:
            nutrients = day.get("nutrients")
            if not isinstance(nutrients, dict) or set(nutrients) != ALL_NUTRIENT_IDS:
                raise AssertionError(f"nutrition_analysis_{days}d_daily_nutrient_map_incomplete")
            if not isinstance(day.get("hasRecords"), bool):
                raise AssertionError("nutrition_analysis_daily_hasRecords_missing")
            if not all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in nutrients.values()):
                raise AssertionError("nutrition_analysis_daily_nutrient_values_invalid")
        if not any(day["hasRecords"] is False for day in summary["dailyTrends"]):
            raise AssertionError(f"nutrition_analysis_{days}d_missing_no-record_gap_fixture")
        if not any(day["nutrients"].get("vitamin_d", 0) > 0 for day in summary["dailyTrends"]):
            raise AssertionError(f"nutrition_analysis_{days}d_test_supplement_not_counted")
        if not any((day.get("totalFeedingMl") or 0) > 0 for day in summary["dailyTrends"]):
            raise AssertionError(f"nutrition_analysis_{days}d_test_milk_not_counted")
        report["checks"].append(f"nutrition/analysis {days}d dailyTrends has all {len(ALL_NUTRIENT_IDS)} nutrient IDs")
        report["checks"].append(f"nutrition/analysis {days}d exposes no-record days for blank chart gaps")

    # BFF and native checks exercise actual identity and baby authorization.
    for method, path in (
        ("GET", f"/api/records/trends?babyId={other_baby['id']}&days=7"),
        ("GET", f"/api/nutrition/analysis?babyId={other_baby['id']}&days=7"),
    ):
        web.call(method, path, 404, headers={"Cookie": owner_cookie})
    web.call("GET", f"/api/records/trends?babyId={baby['id']}&days=7", 409,
             headers={"Cookie": owner_cookie, "x-growdesk-expected-user": str(uuid.uuid4())})
    web.call("GET", f"/api/nutrition/analysis?babyId={baby['id']}&days=7", 409,
             headers={"Cookie": owner_cookie, "x-growdesk-expected-user": str(uuid.uuid4())})
    native.call("GET", f"/api/v1/babies/{other_baby['id']}/records/feeding", (403, 404), headers=bearer(owner["accessToken"]))
    native.call("GET", f"/api/v1/babies/{baby['id']}/records/feeding", (403, 404), headers=bearer(outsider["accessToken"]))
    report["checks"].append("cross-tenant baby reads are denied; expected-user mismatch returns 409")

    fixture = {
        "baseUrl": web_base,
        "webPort": requested_web_port,
        "username": owner["username"],
        "password": owner["password"],
        "familyName": family["name"],
        "babyName": baby["name"],
        "babyId": baby["id"],
        "testTenant": True,
    }
    atomic_json(fixture_path, fixture, 0o600)
    report["browserFixture"] = str(fixture_path)
    report["browserOrigin"] = origin
    report["webLoopbackUrl"] = web_base
    report["browserStatus"] = "PENDING_SEPARATE_PLAYWRIGHT_RUN"


def is_listening(port: int) -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def verify_cleanup(owned, ports: list[int]) -> None:
    problems = []
    for proc in owned.processes:
        if proc.poll() is None:
            problems.append("tracked_process_still_running")
    result = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "label=growdesk.test.owner=" + owned.owner],
        env=owned.env, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        problems.append("owned_container_cleanup_probe_failed")
    elif result.stdout.strip():
        problems.append("owned_containers_remain")
    for port in ports:
        if is_listening(port):
            problems.append("owned_loopback_port_still_listening")
    if problems:
        raise RuntimeError("cleanup_verification_failed:" + ",".join(sorted(set(problems))))


def wait_for_stop(path: Path) -> None:
    while not path.exists():
        time.sleep(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-root", required=True, type=Path,
                        help="isolated source/archive tree of the frozen Go backend")
    parser.add_argument("--web-root", type=Path, default=WEB_ROOT,
                        help="isolated Web release source tree (default: this checkout)")
    parser.add_argument("--backend-revision", default=FROZEN_BACKEND,
                        help="expected backend source revision; a Git checkout is verified exactly")
    parser.add_argument("--web-revision", default=None,
                        help="optional expected Web Git revision; verified when Web source includes .git")
    parser.add_argument("--use-existing-build", action="store_true",
                        help="reuse only a provenance-verified standalone artifact; do not run next build")
    parser.add_argument("--web-port", type=int, default=0,
                        help="optional remote Web port; use a port also free for local SSH -L")
    parser.add_argument("--report", required=True, type=Path, help="mode-0600 JSON evidence report")
    parser.add_argument("--fixture-out", type=Path, default=None,
                        help="mode-0600 browser credentials fixture outside all source trees")
    parser.add_argument("--hold", action="store_true", help="keep owned services alive until stop file appears")
    parser.add_argument("--stop-file", type=Path, default=None,
                        help="sentinel path; with --hold defaults beside the browser fixture")
    args = parser.parse_args()

    backend_root = args.backend_root.resolve()
    web_root = args.web_root.resolve()
    if not backend_root.is_dir() or not web_root.is_dir():
        raise SystemExit("backend-root and web-root must be existing directories")
    if args.backend_revision != FROZEN_BACKEND:
        raise SystemExit("refusing unexpected backend revision; update this acceptance only with a reviewed freeze")
    frozen_backend = git_revision(backend_root)
    if frozen_backend and frozen_backend != args.backend_revision:
        raise SystemExit("backend Git revision does not match the reviewed frozen revision")
    web_revision = git_revision(web_root)
    if args.web_revision and web_revision and web_revision != args.web_revision:
        raise SystemExit("Web Git revision does not match --web-revision")
    expected_web_revision = args.web_revision or web_revision
    if not expected_web_revision or len(expected_web_revision) != 40:
        raise SystemExit("pass the full --web-revision for build provenance verification")

    web_port = choose_port(args.web_port)
    origin = loopback_origin(f"http://127.0.0.1:{web_port}", web_port)
    fixture_path = (args.fixture_out or Path(tempfile.gettempdir()) / f"test_nutrition_trends_{secrets.token_hex(6)}.browser.json").resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    if not fixture_path.is_relative_to(temp_root):
        raise SystemExit("browser fixture must be under the system temporary directory")
    if fixture_path.is_relative_to(backend_root) or fixture_path.is_relative_to(web_root):
        raise SystemExit("browser fixture must be outside source trees")
    if fixture_path.exists():
        raise SystemExit("browser fixture path already exists; refusing to overwrite")
    stop_file = (args.stop_file or fixture_path.with_suffix(".stop")).resolve()
    if args.hold and stop_file.is_relative_to(backend_root):
        raise SystemExit("stop file must be outside source trees")
    if args.hold and stop_file.exists():
        raise SystemExit("stop sentinel already exists; refusing to remove or reuse it")
    report_path = args.report.resolve()
    if report_path.is_relative_to(backend_root) or report_path.is_relative_to(web_root):
        raise SystemExit("report must be written outside source trees")
    report = {
        "scope": "Web nutrition/care trend HTTP acceptance against owned temporary backend",
        "status": "RUNNING", "backendRevision": args.backend_revision,
        "backendRevisionEvidence": "verified_git" if frozen_backend else "caller_attested_archive_revision",
        "backendSourceDigest": source_digest(backend_root),
        "webRevision": web_revision or args.web_revision,
        "webRevisionEvidence": "verified_git" if web_revision else ("caller_attested" if args.web_revision else "not_embedded"),
        "dockerTarget": None, "webLoopbackUrl": None, "webPort": web_port,
        "browserOrigin": origin, "checks": [], "httpObservations": [],
        "externalProviderCalls": 0, "providerKeys": "virtual-test-only",
        "browserStatus": "NOT_RUN_BY_HTTP_RUNNER", "cleanup": {"status": "PENDING"},
    }
    safe_report(report_path, report)

    tools = None
    owned = None
    private_context = tempfile.TemporaryDirectory(prefix="test_nutrition_trends_")
    private = Path(private_context.name)
    cleanup_ports = [web_port]
    fixture_created = False
    result_code = 0
    try:
        report["dockerTarget"] = require_local_docker()
        tools = owned_backend_tools(backend_root)
        owned = tools.OwnedEnvironment()
        sanitize_owned_environment(owned)
        api_binary, migrate_binary = build_backend(backend_root, owned, private, args.backend_revision)
        report["checks"].append("frozen Go API and migrator built; binary revision probe matched")

        if args.use_existing_build:
            provenance = verify_standalone_artifact(web_root, expected_web_revision)
            report["webBuildProvenance"] = provenance
            report["checks"].append("existing standalone artifact provenance and SHA-256 verified")
        else:
            build_web(web_root, owned, private, web_port, expected_web_revision)
            report["webBuildProvenance"] = verify_standalone_artifact(web_root, expected_web_revision)
            report["checks"].append("Next standalone Web built from supplied isolated source")

        owned.start()
        owned.env.update({
            "INVITE_SECRET": secrets.token_hex(32),
            "PUBLIC_BASE_URL": "http://127.0.0.1:1",
            "GROWDESK_AI_PROVIDER": "fixture",
            "GROWDESK_AI_FIXTURE_RESPONSE": '{"text":"test_only","actions":[]}',
            "OPENAI_API_KEY": "test_virtual_no_billing",
            "ANTHROPIC_API_KEY": "test_virtual_no_billing",
        })
        for _ in range(2):
            migration = subprocess.run([str(migrate_binary)], cwd=backend_root, env=owned.env,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       timeout=90, check=False)
            if migration.returncode != 0:
                raise RuntimeError("native_migrations_failed")
        report["checks"].append("native PostgreSQL migrations applied twice with checksum replay")

        native_base = owned.serve(api_binary)
        cleanup_ports.append(int(urllib.parse.urlsplit(native_base).port))
        report["backendLoopbackUrl"] = native_base
        owned.native_base = native_base

        web_base, _, _ = start_web(owned, web_root, web_port, origin, private, "test_virtual_no_billing")
        cleanup_ports.append(web_port)
        report["webLoopbackUrl"] = web_base
        report["checks"].append("standalone Web ready on a dedicated 127.0.0.1 port")

        run_http_acceptance(native_base, web_base, origin, owned, report, fixture_path, web_port)
        fixture_created = True
        report["status"] = "PASS_HTTP_UI_PENDING" if args.hold else "PASS_HTTP"
        safe_report(report_path, report)
        print(json.dumps({
            "status": report["status"], "webLoopbackUrl": web_base,
            "browserOrigin": origin, "browserFixture": str(fixture_path),
            "backendRevision": args.backend_revision,
            "httpAssertions": len(report["httpObservations"]),
        }, ensure_ascii=False), flush=True)
        if args.hold:
            print("Owned services are held for Playwright; create the stop sentinel when the browser report is saved: "
                  + str(stop_file), flush=True)
            wait_for_stop(stop_file)
    except KeyboardInterrupt:
        report["status"] = "INTERRUPTED"
        result_code = 130
    except Exception as error:
        report["status"] = "FAIL"
        report["failure"] = str(error) if isinstance(error, (AssertionError, RuntimeError, SystemExit)) else type(error).__name__
        result_code = 1
    finally:
        if owned is not None:
            try:
                owned.close()
                verify_cleanup(owned, list(dict.fromkeys(cleanup_ports)))
                report["cleanup"] = {"status": "PASS", "ownedContainers": "removed", "trackedProcesses": "stopped",
                                     "loopbackPorts": "released"}
            except Exception as error:
                report["cleanup"] = {"status": "FAIL", "reason": str(error)}
                report["status"] = "FAIL"
                result_code = 1
        else:
            report["cleanup"] = {"status": "NOT_STARTED"}
        if fixture_created:
            with contextlib.suppress(FileNotFoundError):
                fixture_path.unlink()
        with contextlib.suppress(FileNotFoundError):
            stop_file.unlink()
        try:
            private_context.cleanup()
        except Exception as error:
            report["status"] = "FAIL"
            report["cleanup"] = {"status": "FAIL", "reason": "private_temp_cleanup_failed"}
            result_code = 1
        safe_report(report_path, report)
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Verify Web push routes against an owned local Go/PostgreSQL/Redis runtime.

Only the external WebPush gateway is replaced. Authentication and device writes
use the real HTTP API and PostgreSQL. No existing database or .env is loaded.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys


WEB_ROOT = Path(__file__).resolve().parents[2]
TASK_ID = "WEB_PUSH_DELIVERY_20261005"
EVIDENCE_ROOT = WEB_ROOT / "evidence/tasks" / TASK_ID


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true", help="Run against the committed pre-fix push/test route; failures remain exit 1")
    parser.add_argument("--server-root", type=Path)
    parser.add_argument("--ios-root", type=Path)
    args = parser.parse_args()
    # Resolve the original checkout from Git metadata rather than a floating URL.
    common = Path(subprocess.check_output(["git", "rev-parse", "--git-common-dir"], cwd=WEB_ROOT, text=True).strip())
    common = common if common.is_absolute() else WEB_ROOT / common
    workspace = common.resolve().parent.parent
    server_root = (args.server_root or workspace / "growdesk-server").resolve()
    ios_root = (args.ios_root or workspace / "growdesk-ios").resolve()
    helper = ios_root / "scripts/test-cloud-parity.py"
    if not helper.is_file() or not (server_root / "cmd/growdesk-api/main.go").is_file():
        raise RuntimeError("owned_runner_source_missing")
    if not (WEB_ROOT / "node_modules/.bin/tsx").is_file():
        raise RuntimeError("web_tsx_missing")
    spec = importlib.util.spec_from_file_location("owned_push_cloud_runtime", helper)
    if spec is None or spec.loader is None:
        raise RuntimeError("owned_runner_import_failed")
    runtime = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = runtime
    sys.dont_write_bytecode = True
    spec.loader.exec_module(runtime)
    runtime.SERVER_ROOT = server_root
    runtime.EVIDENCE_ROOT = EVIDENCE_ROOT
    # An explicit cached toolchain avoids automatic network dependency fetches.
    original_clean_env = runtime.clean_env

    def clean_env(extra=None):
        return original_clean_env({"GOPROXY": "off", "GOTOOLCHAIN": "go1.27.0", **(extra or {})})

    runtime.clean_env = clean_env
    # The shared runner also embeds this identity in an S3 bucket name.
    run_id = secrets.token_hex(6)
    if not re.fullmatch(r"[a-z0-9_]+", run_id):
        raise RuntimeError("run_identity_invalid")
    runner = runtime.OwnedRun(run_id)
    baseline = WEB_ROOT / "scripts/review" / f"push-test-baseline-{run_id}.ts"
    result_path = runner.evidence / "route-result.json"
    route_path = WEB_ROOT / "app/api/push/test/route.ts"
    outcome = {"taskId": TASK_ID, "runId": run_id, "baseline": args.baseline,
               "startedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
               "passed": False, "claim": "real HTTP authentication and PostgreSQL persistence; gateway delivery is intercepted",
               "physicalDeviceDeliveryVerified": False, "externalPushRequests": 0}
    return_code = 1
    cleanup = None
    stage = "dependency_check"
    try:
        for binary, prefix in (("postgres", "postgres (PostgreSQL) 18."), ("redis-server", "Redis server v=8.")):
            version = runtime.command([runner.executable(binary), "--version"], env=clean_env())
            if not version.startswith(prefix):
                raise RuntimeError("isolated_dependency_version_rejected")
        print("Starting exclusively owned loopback PostgreSQL and Redis.", flush=True)
        stage = "postgres_init"
        runner.init_postgres()
        stage = "redis_init"
        runner.init_redis()
        virtual_vapid = json.loads(runtime.command([
            "node", "--input-type=module", "-e",
            "import webPush from 'web-push'; process.stdout.write(JSON.stringify(webPush.generateVAPIDKeys()));",
        ], cwd=WEB_ROOT, env=clean_env()))
        original_spawn = runner.spawn

        def spawn(name, arguments, *, env=None):
            if name == "api":
                env = {**(env or clean_env()), "VAPID_PUBLIC_KEY": virtual_vapid["publicKey"],
                       "VAPID_PRIVATE_KEY": virtual_vapid["privateKey"],
                       "VAPID_SUBJECT": "mailto:test_push@example.invalid"}
            original_spawn(name, arguments, env=env)

        runner.spawn = spawn
        stage = "go_api_init"
        runner.init_api()
        stage = "database_identity_check"
        expected = f"{runner.database}|{runner.app_role}|false"
        identity = runner.psql("SELECT current_database() || '|' || current_user || '|' || "
                               "(SELECT rolsuper::text FROM pg_roles WHERE rolname=current_user);")
        if identity != expected:
            raise RuntimeError("owned_postgres_identity_guard_failed")
        if args.baseline:
            source = runtime.command(["git", "show", "HEAD:app/api/push/test/route.ts"], cwd=WEB_ROOT, env=clean_env())
            baseline.write_text(source + "\n", encoding="utf-8")
            route_path = baseline
        manifest_path = runner.private / "push-route-manifest.json"
        runtime.persist_private_json(manifest_path, {
            "version": 1, "runId": run_id, "ownerPid": os.getpid(),
            "apiPid": runner.processes["api"].pid, "apiUrl": runner.api_url,
            "webPort": runner.s3_port, "pgPort": runner.pg_port,
            "database": runner.database, "role": runner.app_role,
            "password": runner.pg_app_password, "psql": runner.executable("psql"),
            "routePath": str(route_path), "resultPath": str(result_path),
        })
        node_env = clean_env({
            "NODE_ENV": "development", "DATABASE_URL": "file:./dev_test.db", "PORT": "3089",
            "GROWDESK_ENABLED": "true", "GROWDESK_BACKEND": "go", "GROWDESK_API_URL": runner.api_url,
            "GROWDESK_WEB_ORIGIN": f"http://127.0.0.1:{runner.s3_port}",
            "VAPID_PUBLIC_KEY": "", "VAPID_PRIVATE_KEY": "", "VAPID_SUBJECT": "mailto:test_push@example.invalid",
            "OWNED_PUSH_RUN_MANIFEST": str(manifest_path),
        })
        # No --test/.env-file flag: lib/config must not load an existing .env.test.
        stage = "route_checks"
        completed = subprocess.run(["node", "--import", "tsx", "scripts/review/check-push-persistence.ts"],
                                   cwd=WEB_ROOT, env=node_env, timeout=120, check=False)
        return_code = completed.returncode
        if result_path.is_file():
            outcome["routeChecks"] = json.loads(result_path.read_text(encoding="utf-8"))
        outcome.update({
            "passed": return_code == 0,
            "source": {"webHead": runtime.command(["git", "rev-parse", "HEAD"], cwd=WEB_ROOT, env=clean_env()),
                       "goHead": runtime.command(["git", "rev-parse", "HEAD"], cwd=server_root, env=clean_env()),
                       "routeSha256": hashlib.sha256(route_path.read_bytes()).hexdigest()},
            "isolation": {"host": "127.0.0.1", "database": runner.database, "role": runner.app_role,
                          "superuser": False, "postgresPort": runner.pg_port, "redisPort": runner.redis_port,
                          "apiPort": runner.api_port, "webPort": runner.s3_port,
                          "resourceOwnership": "new cluster and child processes for this run", "workerStarted": False,
                          "goVapidConfiguration": "generated virtual key pair; no worker or delivery invoked"},
        })
    except (Exception, KeyboardInterrupt) as error:
        outcome["failureClass"] = type(error).__name__
        outcome["failureStage"] = stage
        code = str(error)
        if re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_:.]{0,160}", code):
            outcome["failureCode"] = code
        print(f"Owned push verification failed ({type(error).__name__}).", flush=True)
        return_code = 1
    finally:
        baseline.unlink(missing_ok=True)
        try:
            cleanup = runner.cleanup()
            cleanup.update({"taskId": TASK_ID, "resources": ["owned PostgreSQL cluster and test roles",
                                                            "owned Redis process", "owned Go API process"]})
            (runner.evidence / "backend-cleanup.json").write_text(json.dumps(cleanup, indent=2) + "\n", encoding="utf-8")
        except Exception as error:
            outcome["cleanupFailureClass"] = type(error).__name__
            return_code = 1
        # Retain only sanitized reports, never raw infrastructure logs.
        if runner.logs.exists():
            shutil.rmtree(runner.logs)
        outcome["cleanup"] = cleanup
        outcome["passed"] = return_code == 0
        report = runner.evidence / "persistence-report.json"
        report.write_text(json.dumps(outcome, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"PERSISTENCE_REPORT={report}", flush=True)
    return return_code


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()

    signal.signal(signal.SIGTERM, interrupted)
    try:
        raise SystemExit(main())
    except (Exception, KeyboardInterrupt) as error:
        print(f"Owned push runner rejected setup ({type(error).__name__}).", flush=True)
        raise SystemExit(1)

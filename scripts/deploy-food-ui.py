#!/usr/bin/env python3
"""Pinned Web-only publisher for the FOOD_UI_20261102 release."""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import time
from typing import Any

TASK = "FOOD_UI_20261102"
STAGING = Path("/tmp/growdesk-food-ui-release-20261102")
RELEASES = Path("/home/ubuntu/growdesk/food-ui-releases")
STATE = Path("/var/lib/growdesk-food-ui/20261102")
RECEIPT = STATE / "receipt.json"
ROOT = Path(__file__).resolve().parents[1]
PUBLIC_MANIFEST = ROOT / "evidence/tasks/FOOD_UI_20261102/release-manifest.public.json"
SOURCE_EVIDENCE = ROOT / "evidence/tasks/FOOD_UI_20261102/source-manifest.json"
PREVIOUS_SOURCE_EVIDENCE = ROOT / "evidence/tasks/FEEDING_FOOD_20261102/source-manifest.json"
PREVIOUS_SOURCE_EVIDENCE_SHA256 = "a0d6ba20e28a479a7791e6c037e921eba0ff133e8dadeb26ecd92073af5e1a00"
PREVIOUS_TASK = "FEEDING_FOOD_20261102"
EXPECTED_DONORS = {
    "components/records/FoodLogForm.tsx",
    "components/records/WheelSpinnerColumn.tsx",
    "app/food/log/page.tsx",
}

SERVICE = "baby-panel.service"
UNIT = Path("/etc/systemd/system/baby-panel.service")
UNIT_DIR = Path("/etc/systemd/system/baby-panel.service.d")
WORKDIR = "/home/ubuntu/Github/baby_panel_for_cecilia"
BASE_LAUNCHER = Path("/home/ubuntu/growdesk/feeding-food-releases/20261102-d0912afb57c0/launch-web.py")
DROPIN_NAME = "zzzzzzzzzz-food-ui-20261102.conf"
DROPIN = UNIT_DIR / DROPIN_NAME
PORT = 3088
SYSTEMD_PROPERTIES = "FragmentPath,DropInPaths,WorkingDirectory,ExecStart,MainPID,ActiveState"
PROTECTED_UNITS = (
    "growdesk-api.service",
    "growdesk-mcp-api.service",
    "growdesk-mcp-web.service",
    "growdesk-daily-summary-worker.service",
    "growdesk-tts-warm-worker.service",
    "growdesk-voice-control.service",
)

# Public SHA pins captured without printing unit or launcher contents.
PINNED_FILES = {
    str(UNIT): "23202def38541f9e373c3fe1b28ae9de4541e934008354f9c53a03749e2f6b65",
    str(UNIT_DIR / "90-llm-settings-20261023.conf"): "752ece1b334255dd090e0d2f7419d8a63fa8ca6784f10258976ec9a8eb25d23a",
    str(UNIT_DIR / "91-unified-settings-20261023.conf"): "384af92e7b8d018034ab03b2c58f666374d1255b655b2f97c758a2624b30ab91",
    str(UNIT_DIR / "92-gpt-features-20261023.conf"): "effb039ddfadad6922d99f25aafc8b252fa4661717ba2583b2543cc9d2148acc",
    str(UNIT_DIR / "zz-voice-chatgpt-migration.conf"): "673739d0cc07f9ab8c8795ecb277cc030c5b8f3a539b2e048b5ea42d29984bb4",
    str(UNIT_DIR / "zzzzzzzz-openai-defaults-20261030.conf"): "40681b030368ea75a119ea8af476a53ab1213282194db243f504a18a1b663832",
    str(UNIT_DIR / "zzzzzzzzz-feeding-food-20261102.conf"): "92a4b0970ce225c92502c5ba4ec1c0ff7a6cc982f892edff3005bfe9764c2076",
    str(BASE_LAUNCHER): "b9538fa533e41e29b95b99edcd3c900b13fd03fc6582efe24495417f6f5a51a9",
}
OLD_DROPINS = tuple(sorted(path for path in PINNED_FILES if path.startswith(str(UNIT_DIR) + "/")))
PRIVATE_PARTS = {".git", ".data", ".gpt", "backups", "uploads", "archive"}
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".bak", ".backup"}
# These two immutable SDK modules were already in the reviewed 10/30 release.
# This is an exact file/hash exception, never a directory-level data exception.
PINNED_PUBLIC_SDK_FILES = {
    "web/node_modules/openai/resources/uploads/parts.mjs": "3ca3bcb951d0d0d08966f9d1b31291a5f757cfc3ac6ad19cc0c0f878c8df391f",
    "web/node_modules/openai/resources/uploads/uploads.mjs": "a8fdfaeb22030aa50c1fd8838f1fc99f8eddd9b2595cf28a5cc8b156c5b6dec3",
}


class Refusal(RuntimeError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def file_hash(path: Path) -> str:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Refusal(f"expected ordinary file: {path}")
    return sha(path.read_bytes())


def require_root(action: str) -> None:
    if os.geteuid() != 0:
        raise Refusal(f"{action} requires root")


def systemctl(*args: str) -> str:
    result = subprocess.run(["systemctl", *args], text=True, capture_output=True)
    if result.returncode:
        raise Refusal("systemctl command failed: " + " ".join(args[:2]))
    return result.stdout.strip()


def properties(unit: str, names: str) -> dict[str, str]:
    result = systemctl("show", unit, f"--property={names}", "--no-pager")
    values = dict(line.partition("=")[::2] for line in result.splitlines() if "=" in line)
    if set(values) != set(names.split(",")):
        raise Refusal(f"unexpected systemd properties for {unit}")
    return values


def exec_start(raw: str) -> tuple[str, tuple[str, ...]]:
    match = re.search(r"\{\s*path=(.*?)\s*;\s*argv\[\]=(.*?)\s*;\s*ignore_errors=", raw)
    if not match:
        raise Refusal("baby-panel ExecStart metadata is not in the expected form")
    try:
        return match.group(1).strip(), tuple(shlex.split(match.group(2)))
    except ValueError as exc:
        raise Refusal("baby-panel ExecStart could not be parsed") from exc


def expected_dropins(applied: bool) -> set[str]:
    result = set(OLD_DROPINS)
    if applied:
        result.add(str(DROPIN))
    return result


def verify_pinned_files(applied_hash: str | None = None) -> None:
    if UNIT_DIR.is_symlink() or not UNIT_DIR.is_dir():
        raise Refusal("baby-panel drop-in directory is missing or linked")
    names = {p.name for p in UNIT_DIR.iterdir()}
    expected = {Path(p).name for p in OLD_DROPINS} | ({DROPIN_NAME} if applied_hash else set())
    if names != expected:
        raise Refusal("baby-panel drop-in directory has unknown or missing entries")
    for raw, expected_hash in PINNED_FILES.items():
        path = Path(raw)
        if file_hash(path) != expected_hash:
            raise Refusal(f"pinned unit or launcher changed: {path}")
        info = path.lstat()
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o644:
            raise Refusal(f"pinned unit or launcher owner/mode changed: {path}")
    if applied_hash:
        info = DROPIN.lstat()
        if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o644
                or file_hash(DROPIN) != applied_hash):
            raise Refusal("food UI drop-in differs from its receipt")
    elif DROPIN.exists() or DROPIN.is_symlink():
        raise Refusal("task drop-in exists without its owned receipt")


def verify_unit(release: Path | None = None, applied_hash: str | None = None, active: bool = True) -> dict[str, str]:
    verify_pinned_files(applied_hash)
    props = properties(SERVICE, SYSTEMD_PROPERTIES)
    if props["FragmentPath"] != str(UNIT) or props["WorkingDirectory"] != WORKDIR:
        raise Refusal("baby-panel unit fragment or WorkingDirectory changed")
    if set(props["DropInPaths"].split()) != expected_dropins(bool(applied_hash)):
        raise Refusal("baby-panel effective drop-in set changed")
    actual = exec_start(props["ExecStart"])
    expected = ("/usr/bin/python3", ("/usr/bin/python3", str(release / "launch-web.py"))) if release else ("/usr/bin/python3", ("/usr/bin/python3", str(BASE_LAUNCHER)))
    if actual != expected:
        raise Refusal("baby-panel ExecStart differs from the pinned release")
    if active and (props["ActiveState"] != "active" or not props["MainPID"].isdigit() or int(props["MainPID"]) <= 1):
        raise Refusal("baby-panel is not active with a live MainPID")
    return props


def protected_pids() -> dict[str, int]:
    snapshot: dict[str, int] = {}
    for unit in PROTECTED_UNITS:
        values = properties(unit, "MainPID,ActiveState")
        if values["ActiveState"] != "active" or not values["MainPID"].isdigit() or int(values["MainPID"]) <= 1:
            raise Refusal(f"protected service is not active: {unit}")
        snapshot[unit] = int(values["MainPID"])
    return snapshot


def safe_name(path: Path) -> None:
    for part in path.parts:
        name = part.lower()
        if name.startswith(".env") or name in PRIVATE_PARTS or name.startswith("llm-profiles"):
            raise Refusal(f"private/runtime path is forbidden: {path.as_posix()}")
        if Path(name).suffix in PRIVATE_SUFFIXES:
            raise Refusal(f"database or backup path is forbidden: {path.as_posix()}")


def inventory(root: Path) -> tuple[dict[str, str], dict[str, str]]:
    if root.is_symlink() or not root.is_dir():
        raise Refusal(f"release root is missing or linked: {root}")
    resolved = root.resolve(strict=True)
    files: dict[str, str] = {}
    links: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        info = path.lstat()
        name = rel.as_posix()
        if name == "web/node_modules/openai/resources/uploads":
            if not stat.S_ISDIR(info.st_mode):
                raise Refusal("pinned SDK source parent must be an ordinary directory")
        elif name in PINNED_PUBLIC_SDK_FILES:
            if file_hash(path) != PINNED_PUBLIC_SDK_FILES[name]:
                raise Refusal("published SDK module differs from its prior release hash")
        else:
            safe_name(rel)
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(path)
            if os.path.isabs(target):
                raise Refusal(f"absolute symlink is forbidden: {name}")
            try:
                path.resolve(strict=True).relative_to(resolved)
            except (FileNotFoundError, ValueError) as exc:
                raise Refusal(f"broken or escaping symlink: {name}") from exc
            links[name] = target
        elif stat.S_ISDIR(info.st_mode):
            continue
        elif stat.S_ISREG(info.st_mode):
            files[name] = file_hash(path)
        else:
            raise Refusal(f"unexpected filesystem type in release: {name}")
    if not files:
        raise Refusal("release candidate is empty")
    return files, links


def verify_inventory(plan: dict[str, Any], root: Path, runtime_additions: bool = False) -> None:
    files, links = inventory(root)
    expected_files = plan["files"]
    expected_links = plan["links"]
    for name, digest in expected_files.items():
        if files.get(name) != digest:
            raise Refusal(f"reviewed file is missing or changed: {root / name}")
    for name, target in expected_links.items():
        if links.get(name) != target:
            raise Refusal(f"reviewed link is missing or changed: {root / name}")
    extra_files = set(files) - set(expected_files)
    extra_links = set(links) - set(expected_links)
    if extra_links or (extra_files and not runtime_additions):
        raise Refusal(f"unexpected files in release: {sorted(extra_links | extra_files)[:5]}")
    if runtime_additions:
        allowed = ("web/.next/cache/", "web/data/")
        for name in extra_files:
            if not name.startswith(allowed):
                raise Refusal(f"unexpected runtime file in release: {name}")


def validate_source_evidence(expected: str | None = None) -> str:
    if SOURCE_EVIDENCE.is_symlink() or not SOURCE_EVIDENCE.is_file():
        raise Refusal("task source manifest is missing or linked")
    digest = file_hash(SOURCE_EVIDENCE)
    if expected is not None and digest != expected:
        raise Refusal("task source manifest changed after release review")
    if (PREVIOUS_SOURCE_EVIDENCE.is_symlink() or not PREVIOUS_SOURCE_EVIDENCE.is_file()
            or file_hash(PREVIOUS_SOURCE_EVIDENCE) != PREVIOUS_SOURCE_EVIDENCE_SHA256):
        raise Refusal("previous public-source manifest is missing or changed")
    try:
        source = json.loads(SOURCE_EVIDENCE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("task source manifest is invalid JSON") from exc
    previous = source.get("previousSourceManifest")
    if source.get("task") != TASK or source.get("candidate") != "/tmp/growdesk-food-ui-web-20261102":
        raise Refusal("task source manifest belongs to another task or candidate")
    source_commit = source.get("sourceCommit")
    if not isinstance(source_commit, str) or len(source_commit) != 40 or not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise Refusal("task source manifest does not identify a committed source revision")
    if previous != {"path": str(PREVIOUS_SOURCE_EVIDENCE), "sha256": PREVIOUS_SOURCE_EVIDENCE_SHA256}:
        raise Refusal("task source manifest is not based on the reviewed Feeding/Food sources")
    source_files = source.get("sourceFiles")
    donors = source.get("donors")
    baseline_files = source.get("baselineFiles")
    if not isinstance(source_files, dict) or len(source_files) != 573:
        raise Refusal("task source manifest does not contain the pinned 573 public sources")
    try:
        previous_source = json.loads(PREVIOUS_SOURCE_EVIDENCE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("previous public-source manifest is invalid JSON") from exc
    if not isinstance(baseline_files, dict) or baseline_files != previous_source.get("sourceFiles") or set(source_files) != set(baseline_files):
        raise Refusal("task source manifest source set differs from the previous public baseline")
    if not isinstance(donors, dict) or set(donors) != EXPECTED_DONORS:
        raise Refusal("task source manifest donor set changed")
    for name, value in source_files.items():
        if not isinstance(name, str) or not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise Refusal("task source manifest contains an invalid public source entry")
    for name, value in donors.items():
        if source_files.get(name) != value:
            raise Refusal("task donor hash differs from the final public source map")
    return digest


def manifest_plan() -> dict[str, Any]:
    source_digest = validate_source_evidence()
    if STAGING.is_symlink() or not STAGING.is_dir() or {p.name for p in STAGING.iterdir()} != {"web", "launch-web.py"}:
        raise Refusal("staging must contain only web/ and launch-web.py")
    if file_hash(STAGING / "launch-web.py") != PINNED_FILES[str(BASE_LAUNCHER)]:
        raise Refusal("staged launcher differs from the current public launcher")
    build_path = STAGING / "web/.next/BUILD_ID"
    if build_path.is_symlink() or not build_path.is_file():
        raise Refusal("Next production BUILD_ID is missing or linked")
    build_id = build_path.read_text(encoding="utf-8").strip()
    if not build_id or len(build_id) > 128:
        raise Refusal("Next production BUILD_ID is invalid")
    files, links = inventory(STAGING)
    required = {
        "launch-web.py",
        "web/server.js",
        "web/.next/BUILD_ID",
        "web/.next/server/app/food/log/page.js",
        "web/node_modules/next/dist/esm/build/webpack/plugins/flight-manifest-plugin.js",
    }
    if not required <= set(files):
        raise Refusal("standalone Web release is missing required runtime or food route files")
    if links:
        raise Refusal("Web release must not contain symlinks")
    verify_unit()
    plan = {
        "schema": 1,
        "task": TASK,
        "sourceBaseline": {
            "path": str(SOURCE_EVIDENCE),
            "sha256": source_digest,
            "previousManifestSha256": PREVIOUS_SOURCE_EVIDENCE_SHA256,
        },
        "serviceBaseline": {
            "fragment": str(UNIT),
            "fragmentSha256": PINNED_FILES[str(UNIT)],
            "workingDirectory": WORKDIR,
            "launcher": str(BASE_LAUNCHER),
            "dropins": {Path(p).name: PINNED_FILES[p] for p in OLD_DROPINS},
        },
        "staging": str(STAGING),
        "releaseRoot": str(RELEASES),
        "dropin": str(DROPIN),
        "webBuildId": build_id,
        "files": files,
        "links": links,
        "restartedServices": [SERVICE],
        "protectedUnits": list(PROTECTED_UNITS),
    }
    plan["manifestSha256"] = sha(canonical(plan))
    return plan

def write_public_manifest(plan: dict[str, Any]) -> None:
    data = (json.dumps(plan, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    if PUBLIC_MANIFEST.parent.is_symlink() or not PUBLIC_MANIFEST.parent.is_dir():
        raise Refusal("task evidence directory is missing or linked")
    if PUBLIC_MANIFEST.exists() or PUBLIC_MANIFEST.is_symlink():
        if PUBLIC_MANIFEST.is_symlink() or PUBLIC_MANIFEST.read_bytes() != data:
            raise Refusal("public release manifest exists with different contents")
        return
    fd = os.open(PUBLIC_MANIFEST, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    os.fchmod(fd, 0o644)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def read_manifest(expected: str | None = None) -> dict[str, Any]:
    if PUBLIC_MANIFEST.is_symlink() or not PUBLIC_MANIFEST.is_file():
        raise Refusal("public release manifest is missing; run audit --write-manifest")
    plan = json.loads(PUBLIC_MANIFEST.read_text(encoding="utf-8"))
    digest = plan.pop("manifestSha256", None)
    if not isinstance(digest, str) or sha(canonical(plan)) != digest:
        raise Refusal("public release manifest fingerprint is invalid")
    plan["manifestSha256"] = digest
    if expected and digest != expected:
        raise Refusal("manifest differs from the reviewed fingerprint")
    if plan.get("task") != TASK:
        raise Refusal("manifest belongs to another task")
    source = plan.get("sourceBaseline")
    if not isinstance(source, dict) or source.get("path") != str(SOURCE_EVIDENCE):
        raise Refusal("manifest does not bind the task public-source evidence")
    if source.get("previousManifestSha256") != PREVIOUS_SOURCE_EVIDENCE_SHA256:
        raise Refusal("manifest does not bind the reviewed previous public-source baseline")
    validate_source_evidence(source.get("sha256"))
    return plan

def state_write(receipt: dict[str, Any], create: bool = False) -> None:
    require_root("receipt update")
    parent = STATE.parent
    if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
        raise Refusal("private state parent is missing or linked")
    parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if parent.lstat().st_uid != 0 or stat.S_IMODE(parent.stat().st_mode) != 0o700:
        raise Refusal("private state parent owner/mode changed")
    if STATE.is_symlink() or (STATE.exists() and not STATE.is_dir()):
        raise Refusal("private state directory is missing or linked")
    if not STATE.exists():
        if not create:
            raise Refusal("private receipt directory is missing")
        STATE.mkdir(mode=0o700)
    if STATE.lstat().st_uid != 0 or stat.S_IMODE(STATE.stat().st_mode) != 0o700:
        raise Refusal("private state directory owner/mode changed")
    tmp = STATE / "receipt.json.new"
    if tmp.exists() or tmp.is_symlink():
        raise Refusal("unexpected receipt temp file exists")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write((json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode())
        stream.flush()
        os.fsync(stream.fileno())
    if RECEIPT.exists() and (RECEIPT.is_symlink() or RECEIPT.lstat().st_uid != 0 or stat.S_IMODE(RECEIPT.stat().st_mode) != 0o600):
        raise Refusal("existing receipt owner/mode changed")
    os.replace(tmp, RECEIPT)


def state_read() -> dict[str, Any]:
    require_root("receipt read")
    if STATE.is_symlink() or not STATE.is_dir() or RECEIPT.is_symlink() or not RECEIPT.is_file():
        raise Refusal("private receipt is missing or linked")
    if STATE.lstat().st_uid != 0 or stat.S_IMODE(STATE.stat().st_mode) != 0o700:
        raise Refusal("private state owner/mode changed")
    if RECEIPT.lstat().st_uid != 0 or stat.S_IMODE(RECEIPT.stat().st_mode) != 0o600:
        raise Refusal("private receipt owner/mode changed")
    value = json.loads(RECEIPT.read_text(encoding="utf-8"))
    if value.get("schema") != 1 or value.get("task") != TASK:
        raise Refusal("private receipt schema/task mismatch")
    return value


def release_path(plan: dict[str, Any]) -> Path:
    return RELEASES / ("20261102-" + plan["manifestSha256"][:12])


def verify_release(receipt: dict[str, Any], plan: dict[str, Any], runtime_additions: bool = False) -> Path:
    path = release_path(plan)
    if receipt.get("release") != str(path) or path.is_symlink() or not path.is_dir():
        raise Refusal("release path differs from the reviewed immutable release")
    verify_inventory(plan, path, runtime_additions=runtime_additions)
    return path


def prepare(digest: str) -> dict[str, Any]:
    require_root("prepare")
    plan = read_manifest(digest)
    verify_unit()
    verify_inventory(plan, STAGING)
    release = release_path(plan)
    if RELEASES.is_symlink() or (RELEASES.exists() and not RELEASES.is_dir()):
        raise Refusal("release root is missing or linked")
    releases_existed = RELEASES.exists()
    RELEASES.mkdir(mode=0o755, parents=True, exist_ok=True)
    if not releases_existed:
        RELEASES.chmod(0o755)
    elif RELEASES.stat().st_mode & 0o755 != 0o755:
        raise Refusal("release root is not readable/traversable by the Web service")
    if release.exists() or release.is_symlink() or STATE.exists() or STATE.is_symlink():
        raise Refusal("release or private receipt already exists; refusing overwrite")
    shutil.copytree(STAGING, release, symlinks=True)
    release.chmod(0o755)
    for path in release.rglob("*"):
        if path.is_symlink():
            continue
        mode = path.stat().st_mode
        path.chmod(0o755 if stat.S_ISDIR(mode) or mode & 0o111 else 0o644)
    verify_inventory(plan, release)
    receipt = {
        "schema": 1, "task": TASK, "status": "PREPARED", "phase": "release-copied",
        "release": str(release), "manifestSha256": digest, "dropin": str(DROPIN),
        "dropinSha256": None, "webBuildId": plan["webBuildId"], "createdAtUtc": int(time.time()),
    }
    state_write(receipt, create=True)
    return {"status": "PREPARED", "release": str(release), "manifestSha256": digest, "webBuildId": plan["webBuildId"]}


def protected_snapshot() -> dict[str, int]:
    result: dict[str, int] = {}
    for unit in PROTECTED_UNITS:
        values = properties(unit, "MainPID,ActiveState")
        if values["ActiveState"] != "active" or not values["MainPID"].isdigit() or int(values["MainPID"]) <= 1:
            raise Refusal(f"protected service is not active: {unit}")
        result[unit] = int(values["MainPID"])
    return result


def assert_protected_unchanged(before: dict[str, int]) -> dict[str, int]:
    after = protected_snapshot()
    if before != after:
        raise Refusal("protected API/MCP/worker/TTS MainPID changed during Web-only operation")
    return after


def dropin_bytes(release: Path) -> bytes:
    return ("[Service]\nExecStart=\nExecStart=/usr/bin/python3 " + str(release / "launch-web.py") + "\n").encode()


def create_dropin(release: Path) -> str:
    data = dropin_bytes(release)
    directory = os.open(UNIT_DIR, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        fd = os.open(DROPIN_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644, dir_fd=directory)
        os.fchmod(fd, 0o644)
        try:
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(fd)
        os.fsync(directory)
    finally:
        os.close(directory)
    return sha(data)


def remove_dropin(expected: str) -> None:
    if DROPIN.is_symlink() or not DROPIN.is_file() or file_hash(DROPIN) != expected:
        raise Refusal("refusing to remove a drop-in not owned by this release")
    if DROPIN.lstat().st_uid != 0 or stat.S_IMODE(DROPIN.stat().st_mode) != 0o644:
        raise Refusal("owned drop-in owner/mode changed")
    DROPIN.unlink()


def readiness() -> None:
    deadline = time.monotonic() + 45
    last_status = None
    while time.monotonic() < deadline:
        connection = http.client.HTTPConnection("127.0.0.1", PORT, timeout=3)
        try:
            connection.request("GET", "/settings", headers={"Connection": "close"})
            response = connection.getresponse()
            response.read(1024)
            last_status = response.status
            if last_status == 200:
                return
        except OSError:
            pass
        finally:
            connection.close()
        time.sleep(1)
    raise Refusal(f"Web readiness failed; last /settings status={last_status}")


def restart_web() -> None:
    systemctl("restart", SERVICE)
    readiness()


def rollback_applied(receipt: dict[str, Any], plan: dict[str, Any], protected: dict[str, int] | None = None) -> dict[str, Any]:
    release = verify_release(receipt, plan, runtime_additions=True)
    digest = receipt.get("dropinSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise Refusal("receipt lacks the owned drop-in hash")
    verify_pinned_files(digest)
    props = properties(SERVICE, SYSTEMD_PROPERTIES)
    if props["FragmentPath"] != str(UNIT) or props["WorkingDirectory"] != WORKDIR:
        raise Refusal("baby-panel unit baseline changed before rollback")
    paths = set(props["DropInPaths"].split())
    actual = exec_start(props["ExecStart"])
    old = ("/usr/bin/python3", ("/usr/bin/python3", str(BASE_LAUNCHER)))
    new = ("/usr/bin/python3", ("/usr/bin/python3", str(release / "launch-web.py")))
    if paths == expected_dropins(True):
        if actual != new:
            raise Refusal("baby-panel no longer runs this release; refusing rollback")
    elif paths == expected_dropins(False):
        if actual != old:
            raise Refusal("baby-panel is not on this release or its baseline; refusing rollback")
    else:
        raise Refusal("unknown effective drop-in state; refusing rollback")

    if protected is None:
        protected = protected_snapshot()
    receipt["status"] = "ROLLING_BACK"
    receipt["phase"] = "dropin-removal-requested"
    state_write(receipt)
    remove_dropin(digest)
    systemctl("daemon-reload")
    # Configuration is checked without requiring the failed Web process to be
    # active; then the known prior launcher is restarted and checked.
    verify_unit(active=False)
    restart_web()
    restored = verify_unit()
    after = protected_snapshot()
    receipt.update(status="ROLLED_BACK", phase="baseline-restored", rollbackMainPid=int(restored["MainPID"]),
                   protectedPidsBeforeRollback=protected, protectedPidsAfterRollback=after, rolledBackAtUtc=int(time.time()))
    state_write(receipt)
    if protected != after:
        raise Refusal("Web baseline restored, but a protected service MainPID changed")
    return {"status": "ROLLED_BACK", "serviceRestarted": True, "releaseRetained": True}


def apply() -> dict[str, Any]:
    require_root("apply")
    receipt = state_read()
    plan = read_manifest(receipt.get("manifestSha256"))
    release = verify_release(receipt, plan, runtime_additions=receipt.get("status") == "APPLIED")
    if receipt["status"] == "APPLIED":
        props = verify_unit(release, receipt.get("dropinSha256"))
        prior = receipt.get("protectedPidsAfterApply")
        if not isinstance(prior, dict) or protected_snapshot() != prior:
            raise Refusal("protected service MainPIDs differ from the applied receipt")
        return {"status": "APPLIED", "release": str(release), "webBuildId": receipt["webBuildId"], "mainPid": int(props["MainPID"])}
    if receipt["status"] != "PREPARED":
        raise Refusal("only a prepared release can be applied")

    verify_unit()
    before = protected_snapshot()
    receipt.update(status="APPLYING", phase="dropin-install-requested", protectedPidsBeforeApply=before)
    state_write(receipt)
    owned_hash = None
    try:
        owned_hash = create_dropin(release)
        receipt.update(dropinSha256=owned_hash, phase="dropin-installed")
        state_write(receipt)
        systemctl("daemon-reload")
        verify_unit(release, owned_hash)
        restart_web()
        props = verify_unit(release, owned_hash)
        after = protected_snapshot()
        receipt.update(status="APPLIED", phase="verified", protectedPidsAfterApply=after, webMainPid=int(props["MainPID"]), appliedAtUtc=int(time.time()))
        state_write(receipt)
        if before != after:
            raise Refusal("protected API/MCP/worker/TTS MainPID changed during Web-only operation")
        return {"status": "APPLIED", "release": str(release), "webBuildId": receipt["webBuildId"], "mainPid": receipt["webMainPid"]}
    except Exception as failure:
        try:
            if owned_hash and DROPIN.exists() and not DROPIN.is_symlink() and file_hash(DROPIN) == owned_hash:
                rollback_applied(receipt, plan, protected=before)
            else:
                verify_unit()
                assert_protected_unchanged(before)
                receipt.update(status="ROLLED_BACK", phase="no-system-change", rolledBackAtUtc=int(time.time()))
                state_write(receipt)
        except Exception as rollback_failure:
            raise Refusal(f"apply failed ({failure}); automatic rollback refused/failed ({rollback_failure})") from failure
        raise Refusal(f"apply failed and Web-only rollback completed: {failure}") from failure


def rollback() -> dict[str, Any]:
    require_root("rollback")
    receipt = state_read()
    plan = read_manifest(receipt.get("manifestSha256"))
    if receipt["status"] == "ROLLED_BACK":
        verify_unit()
        return {"status": "ROLLED_BACK", "serviceRestarted": False, "releaseRetained": True}
    if receipt["status"] == "PREPARED":
        verify_release(receipt, plan)
        verify_unit()
        receipt.update(status="ROLLED_BACK", phase="prepared-release-retained", rolledBackAtUtc=int(time.time()))
        state_write(receipt)
        return {"status": "ROLLED_BACK", "serviceRestarted": False, "releaseRetained": True}
    if receipt["status"] in {"APPLIED", "APPLYING", "ROLLING_BACK"}:
        if receipt["status"] == "APPLYING" and not receipt.get("dropinSha256") and not DROPIN.exists() and not DROPIN.is_symlink():
            verify_unit()
            receipt.update(status="ROLLED_BACK", phase="no-system-change", rolledBackAtUtc=int(time.time()))
            state_write(receipt)
            return {"status": "ROLLED_BACK", "serviceRestarted": False, "releaseRetained": True}
        if receipt["status"] == "ROLLING_BACK" and not DROPIN.exists() and not DROPIN.is_symlink():
            verify_unit(active=False)
            before = protected_snapshot()
            restart_web()
            props = verify_unit()
            after = protected_snapshot()
            receipt.update(status="ROLLED_BACK", phase="baseline-restored", rollbackMainPid=int(props["MainPID"]),
                           protectedPidsBeforeRollback=before, protectedPidsAfterRollback=after, rolledBackAtUtc=int(time.time()))
            state_write(receipt)
            if before != after:
                raise Refusal("Web baseline restored, but a protected service MainPID changed")
            return {"status": "ROLLED_BACK", "serviceRestarted": True, "releaseRetained": True}
        return rollback_applied(receipt, plan)
    raise Refusal("unknown receipt state; refusing systemd changes")


def audit(write_manifest: bool) -> dict[str, Any]:
    plan = manifest_plan()
    protected = protected_snapshot()
    if write_manifest:
        write_public_manifest(plan)
    return {
        "status": "AUDITED",
        "manifestPath": str(PUBLIC_MANIFEST) if write_manifest else None,
        "manifestSha256": plan["manifestSha256"],
        "files": len(plan["files"]),
        "links": len(plan["links"]),
        "webBuildId": plan["webBuildId"],
        "dropin": str(DROPIN),
        "restartedServices": [SERVICE],
        "protectedUnits": list(PROTECTED_UNITS),
        "protectedPidsAtAudit": protected,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    audit_parser = commands.add_parser("audit", help="read-only staging/unit dry-run")
    audit_parser.add_argument("--write-manifest", action="store_true")
    prep = commands.add_parser("prepare", help="copy a reviewed manifest into an immutable release")
    prep.add_argument("--manifest-sha256", required=True)
    commands.add_parser("apply", help="add the Web-only ExecStart drop-in and restart baby-panel")
    commands.add_parser("rollback", help="remove only the hash-matched task drop-in and restore Web")
    args = parser.parse_args()

    if args.action == "audit":
        result = audit(args.write_manifest)
    elif args.action == "prepare":
        result = prepare(args.manifest_sha256)
    elif args.action == "apply":
        result = apply()
    else:
        result = rollback()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Refusal as exc:
        raise SystemExit(f"REFUSED: {exc}") from exc

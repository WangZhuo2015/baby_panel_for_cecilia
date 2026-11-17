#!/usr/bin/env python3
"""Stage the prior verified public Web source and exactly three FOOD_UI donors."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TASK = "FOOD_UI_20261102"
PREVIOUS_TASK = "FEEDING_FOOD_20261102"
PREVIOUS_SOURCE_MANIFEST = ROOT / "evidence/tasks/FEEDING_FOOD_20261102/source-manifest.json"
PREVIOUS_SOURCE_MANIFEST_SHA256 = "a0d6ba20e28a479a7791e6c037e921eba0ff133e8dadeb26ecd92073af5e1a00"
PREVIOUS_CANDIDATE = Path("/tmp/growdesk-feeding-food-web-20261102")
BUILD_BASELINE = Path("/tmp/growdesk-openai-defaults-web-20261030")
OUT = Path("/tmp/growdesk-food-ui-web-20261102")
EVIDENCE = ROOT / "evidence/tasks/FOOD_UI_20261102/source-manifest.json"
DONORS = (
    "components/records/FoodLogForm.tsx",
    "components/records/WheelSpinnerColumn.tsx",
    "app/food/log/page.tsx",
)
PRIVATE_PARTS = {".git", ".data", ".gpt", "backups", "uploads", "archive", "node_modules", ".next"}
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".bak", ".backup"}


class Refusal(RuntimeError):
    pass


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def file_hash(path: Path) -> str:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Refusal(f"expected ordinary file: {path}")
    return digest_bytes(path.read_bytes())


def safe_relative(raw: str) -> PurePosixPath:
    rel = PurePosixPath(raw)
    if rel.is_absolute() or not rel.parts or ".." in rel.parts or "." in rel.parts:
        raise Refusal(f"unsafe source path: {raw}")
    for component in rel.parts:
        lowered = component.lower()
        if lowered.startswith(".env") or lowered in PRIVATE_PARTS:
            raise Refusal(f"private/runtime source path is forbidden: {raw}")
        if lowered.startswith("llm-profiles") and rel.as_posix() != "lib/llm-profiles.ts":
            raise Refusal(f"private profile path is forbidden: {raw}")
        if Path(lowered).suffix in PRIVATE_SUFFIXES:
            raise Refusal(f"database/backup source path is forbidden: {raw}")
    return rel


def checked_file(root: Path, relative: str) -> Path:
    rel = safe_relative(relative)
    current = root
    for component in rel.parts:
        current = current / component
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise Refusal(f"linked source path is forbidden: {relative}")
    if not current.is_file():
        raise Refusal(f"source file is missing: {relative}")
    return current


def load_previous() -> tuple[dict[str, str], dict]:
    if PREVIOUS_SOURCE_MANIFEST.is_symlink() or not PREVIOUS_SOURCE_MANIFEST.is_file():
        raise Refusal("previous source manifest is missing or linked")
    if file_hash(PREVIOUS_SOURCE_MANIFEST) != PREVIOUS_SOURCE_MANIFEST_SHA256:
        raise Refusal("previous source manifest differs from its reviewed fingerprint")
    try:
        manifest = json.loads(PREVIOUS_SOURCE_MANIFEST.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("previous source manifest is invalid JSON") from exc
    if manifest.get("task") != PREVIOUS_TASK or manifest.get("candidate") != str(PREVIOUS_CANDIDATE):
        raise Refusal("previous source manifest task/candidate mismatch")
    source_files = manifest.get("sourceFiles")
    if not isinstance(source_files, dict) or len(source_files) != 573:
        raise Refusal("previous source manifest must pin exactly 573 public source files")
    if PREVIOUS_CANDIDATE.is_symlink() or not PREVIOUS_CANDIDATE.is_dir():
        raise Refusal("previous public-source candidate is missing or linked")
    for relative, expected in source_files.items():
        if not isinstance(expected, str) or len(expected) != 64:
            raise Refusal(f"invalid previous source hash: {relative}")
        item = checked_file(PREVIOUS_CANDIDATE, relative)
        if file_hash(item) != expected:
            raise Refusal(f"previous public source changed: {relative}")
    return source_files, manifest


def verified_build_input(name: str, expected: Path) -> Path:
    item = PREVIOUS_CANDIDATE / name
    if not item.is_symlink() or os.readlink(item) != str(expected):
        raise Refusal(f"previous {name} build link differs from the known public dependency target")
    if expected.is_symlink() or not expected.is_dir():
        raise Refusal(f"verified build input is missing or linked: {expected}")
    return expected


def committed_source_head() -> str:
    base = "ca385c8216e6a7a4581aaf0d8e95c74bc66923c3"
    try:
        head = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
        ancestry = subprocess.run(
            ["git", "-C", str(ROOT), "merge-base", "--is-ancestor", base, "HEAD"],
            text=True, capture_output=True,
        )
        dirty = subprocess.run(
            ["git", "-C", str(ROOT), "status", "--porcelain", "--untracked-files=no", "--", *DONORS],
            check=True, text=True, capture_output=True,
        ).stdout.strip()
    except subprocess.CalledProcessError as exc:
        raise Refusal("could not verify the Web source commit") from exc
    if len(head) != 40 or any(ch not in "0123456789abcdef" for ch in head):
        raise Refusal("Web source HEAD is not a full commit id")
    if ancestry.returncode != 0:
        raise Refusal("Web source HEAD is not based on the pinned ca385c82 main")
    if dirty:
        raise Refusal("UI donor files must be committed before source staging")
    return head


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    if OUT.exists() or OUT.is_symlink():
        raise Refusal("candidate already exists; preserving it")
    if EVIDENCE.exists() or EVIDENCE.is_symlink():
        raise Refusal("task source manifest already exists; preserving it")
    if EVIDENCE.parent.is_symlink() or not EVIDENCE.parent.is_dir():
        raise Refusal("task evidence directory is missing or linked")

    source_commit = committed_source_head()
    previous_files, _ = load_previous()
    build_inputs = {
        "node_modules": verified_build_input("node_modules", BUILD_BASELINE / "node_modules"),
        "generated": verified_build_input("generated", BUILD_BASELINE / "generated"),
    }
    source_files = dict(previous_files)
    OUT.mkdir(mode=0o755)
    for relative, expected in previous_files.items():
        source = checked_file(PREVIOUS_CANDIDATE, relative)
        destination = OUT.joinpath(*safe_relative(relative).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        if file_hash(destination) != expected:
            raise Refusal(f"copied source hash changed: {relative}")

    donors = {}
    for relative in DONORS:
        donor = checked_file(ROOT, relative)
        destination = OUT.joinpath(*safe_relative(relative).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(donor, destination)
        donor_hash = file_hash(donor)
        if file_hash(destination) != donor_hash:
            raise Refusal(f"donor copy hash changed: {relative}")
        donors[relative] = donor_hash
        source_files[relative] = donor_hash

    (OUT / "node_modules").symlink_to(build_inputs["node_modules"], target_is_directory=True)
    (OUT / "generated").symlink_to(build_inputs["generated"], target_is_directory=True)
    evidence = {
        "task": TASK,
        "mainBaseline": "ca385c8216e6a7a4581aaf0d8e95c74bc66923c3",
        "sourceCommit": source_commit,
        "candidate": str(OUT),
        "previousSourceManifest": {
            "path": str(PREVIOUS_SOURCE_MANIFEST),
            "sha256": PREVIOUS_SOURCE_MANIFEST_SHA256,
        },
        "previousCandidate": str(PREVIOUS_CANDIDATE),
        "baselineFiles": previous_files,
        "donors": donors,
        "sourceFiles": source_files,
        "buildInputs": {name: str(path) for name, path in build_inputs.items()},
        "privateRuntimeFilesCopied": False,
        "databaseMigrations": False,
    }
    encoded = (json.dumps(evidence, ensure_ascii=False, indent=2) + "\n").encode()
    fd = os.open(EVIDENCE, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    with os.fdopen(fd, "wb") as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({
        "task": TASK,
        "candidate": str(OUT),
        "baselinePublicSources": len(previous_files),
        "uiDonors": len(donors),
        "sourceEvidence": str(EVIDENCE),
        "sourceEvidenceSha256": digest_bytes(encoded),
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Refusal as exc:
        raise SystemExit(f"REFUSED: {exc}") from exc

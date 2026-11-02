#!/usr/bin/env python3
"""Freeze a standalone FOOD_UI Web package using the verified prior runtime dependencies."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat

ROOT = Path(__file__).resolve().parents[1]
TASK = "FOOD_UI_20261102"
SOURCE = Path("/tmp/growdesk-food-ui-web-20261102")
STANDALONE = SOURCE / ".next/standalone"
STAGING = Path("/tmp/growdesk-food-ui-release-20261102")
SOURCE_EVIDENCE = ROOT / "evidence/tasks/FOOD_UI_20261102/source-manifest.json"
PREVIOUS_SOURCE_EVIDENCE = ROOT / "evidence/tasks/FEEDING_FOOD_20261102/source-manifest.json"
PREVIOUS_SOURCE_EVIDENCE_SHA256 = "a0d6ba20e28a479a7791e6c037e921eba0ff133e8dadeb26ecd92073af5e1a00"
PREVIOUS_RELEASE_ROOT = Path("/home/ubuntu/growdesk/feeding-food-releases")
PREVIOUS_RELEASE = PREVIOUS_RELEASE_ROOT / "20261102-d0912afb57c0"
PREVIOUS_RELEASE_MANIFEST = Path("/home/ubuntu/Github/growdesk-server/evidence/tasks/FEEDING_FOOD_20261102/release-manifest.public.json")
PREVIOUS_RELEASE_MANIFEST_SHA256 = "b3e117014b6dd7e2973ae16a99a8d6a8532ba424286d9c53ddb9a638e08bacbb"
PREVIOUS_RELEASE_DIGEST = "d0912afb57c0976a143afd78e5634287f26c58be43581c7c95c1d454747401f1"
PREVIOUS_BUILD_SOURCE = Path("/tmp/growdesk-openai-defaults-web-20261030")
BASE_LAUNCHER = PREVIOUS_RELEASE / "launch-web.py"
BASE_LAUNCHER_SHA256 = "b9538fa533e41e29b95b99edcd3c900b13fd03fc6582efe24495417f6f5a51a9"
CATALOGS = (
    "01_sources.json",
    "02_vaccines.json",
    "03_milestones.json",
    "04_foods.json",
    "05_books.json",
    "06_activities.json",
)
PRIVATE_PARTS = {".git", ".data", ".gpt", "backups", "uploads", "archive"}
PRIVATE_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".bak", ".backup"}
PINNED_PUBLIC_SDK_FILES = {
    "web/node_modules/openai/resources/uploads/parts.mjs": "3ca3bcb951d0d0d08966f9d1b31291a5f757cfc3ac6ad19cc0c0f878c8df391f",
    "web/node_modules/openai/resources/uploads/uploads.mjs": "a8fdfaeb22030aa50c1fd8838f1fc99f8eddd9b2595cf28a5cc8b156c5b6dec3",
}


class Refusal(RuntimeError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def file_hash(path: Path) -> str:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise Refusal(f"expected ordinary file: {path}")
    return sha(path.read_bytes())


def relative(raw: str) -> PurePosixPath:
    rel = PurePosixPath(raw)
    if rel.is_absolute() or not rel.parts or ".." in rel.parts or "." in rel.parts:
        raise Refusal(f"unsafe relative path: {raw}")
    return rel


def safe_name(rel: PurePosixPath) -> None:
    name = rel.as_posix()
    if name in PINNED_PUBLIC_SDK_FILES or name == "web/node_modules/openai/resources/uploads":
        return
    for part in rel.parts:
        lowered = part.lower()
        if lowered.startswith(".env") or lowered in PRIVATE_PARTS:
            raise Refusal(f"private/runtime path is forbidden: {name}")
        if lowered.startswith("llm-profiles"):
            raise Refusal(f"private profile path is forbidden: {name}")
        if Path(lowered).suffix in PRIVATE_SUFFIXES:
            raise Refusal(f"database or backup path is forbidden: {name}")


def checked_file(root: Path, raw: str) -> Path:
    rel = relative(raw)
    path = root
    for part in rel.parts:
        path = path / part
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise Refusal(f"linked file path is forbidden: {raw}")
    if not path.is_file():
        raise Refusal(f"file is missing: {raw}")
    return path


def safe_source_name(rel: PurePosixPath) -> None:
    if rel.as_posix() == "lib/llm-profiles.ts":
        return
    safe_name(rel)


def inventory(root: Path, allow_sdk: bool = True) -> dict[str, str]:
    if root.is_symlink() or not root.is_dir():
        raise Refusal(f"directory is missing or linked: {root}")
    result: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        name = rel.as_posix()
        normalized = PurePosixPath(name)
        if not allow_sdk and (name in PINNED_PUBLIC_SDK_FILES or name == "web/node_modules/openai/resources/uploads"):
            raise Refusal("SDK uploads path is unexpected in this source tree")
        safe_name(normalized)
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise Refusal(f"symlink is forbidden in frozen package: {name}")
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode):
            raise Refusal(f"unexpected filesystem entry: {name}")
        digest = file_hash(path)
        if name in PINNED_PUBLIC_SDK_FILES and digest != PINNED_PUBLIC_SDK_FILES[name]:
            raise Refusal("pinned SDK module differs from the prior frozen public release")
        result[name] = digest
    if not result:
        raise Refusal(f"empty package tree: {root}")
    return result


def validate_source_evidence() -> tuple[dict, str]:
    if SOURCE_EVIDENCE.is_symlink() or not SOURCE_EVIDENCE.is_file():
        raise Refusal("task source manifest is missing or linked; stage public sources first")
    if (PREVIOUS_SOURCE_EVIDENCE.is_symlink() or not PREVIOUS_SOURCE_EVIDENCE.is_file()
            or file_hash(PREVIOUS_SOURCE_EVIDENCE) != PREVIOUS_SOURCE_EVIDENCE_SHA256):
        raise Refusal("previous public source manifest changed")
    digest = file_hash(SOURCE_EVIDENCE)
    try:
        document = json.loads(SOURCE_EVIDENCE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("task source manifest is invalid JSON") from exc
    if document.get("task") != TASK or document.get("candidate") != str(SOURCE):
        raise Refusal("task source manifest task/candidate mismatch")
    source_commit = document.get("sourceCommit")
    if not isinstance(source_commit, str) or len(source_commit) != 40 or any(ch not in "0123456789abcdef" for ch in source_commit):
        raise Refusal("task source manifest does not identify a committed source revision")
    if document.get("previousSourceManifest") != {
        "path": str(PREVIOUS_SOURCE_EVIDENCE),
        "sha256": PREVIOUS_SOURCE_EVIDENCE_SHA256,
    }:
        raise Refusal("task source manifest is not anchored to the previous public-source evidence")
    source_files = document.get("sourceFiles")
    donors = document.get("donors")
    expected_donors = {
        "components/records/FoodLogForm.tsx",
        "components/records/WheelSpinnerColumn.tsx",
        "app/food/log/page.tsx",
    }
    if not isinstance(source_files, dict) or len(source_files) != 573:
        raise Refusal("task source manifest must contain exactly 573 public files")
    if not isinstance(donors, dict) or set(donors) != expected_donors:
        raise Refusal("task source manifest donor set changed")
    try:
        previous_source = json.loads(PREVIOUS_SOURCE_EVIDENCE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("previous public-source manifest is invalid JSON") from exc
    baseline_files = document.get("baselineFiles")
    if (not isinstance(baseline_files, dict)
            or baseline_files != previous_source.get("sourceFiles")
            or set(source_files) != set(baseline_files)):
        raise Refusal("task source file set differs from the previous public baseline")
    if SOURCE.is_symlink() or not SOURCE.is_dir():
        raise Refusal("task source candidate is missing or linked")
    for name, expected in source_files.items():
        if not isinstance(name, str) or not isinstance(expected, str) or len(expected) != 64:
            raise Refusal("task source manifest contains an invalid source entry")
        safe_source_name(relative(name))
        source = checked_file(SOURCE, name)
        if file_hash(source) != expected:
            raise Refusal(f"public source changed after staging: {name}")
    for name, expected in donors.items():
        if source_files.get(name) != expected:
            raise Refusal(f"UI donor differs from the final public source map: {name}")
    return document, digest


def load_previous_release() -> tuple[dict, dict[str, str]]:
    if PREVIOUS_RELEASE_MANIFEST.is_symlink() or not PREVIOUS_RELEASE_MANIFEST.is_file():
        raise Refusal("previous public release manifest is missing or linked")
    if file_hash(PREVIOUS_RELEASE_MANIFEST) != PREVIOUS_RELEASE_MANIFEST_SHA256:
        raise Refusal("previous public release manifest differs from its reviewed fingerprint")
    try:
        plan = json.loads(PREVIOUS_RELEASE_MANIFEST.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise Refusal("previous public release manifest is invalid JSON") from exc
    digest = plan.pop("manifestSha256", None)
    if digest != PREVIOUS_RELEASE_DIGEST or sha(canonical(plan)) != digest:
        raise Refusal("previous public release manifest internal fingerprint mismatch")
    plan["manifestSha256"] = digest
    expected_files = plan.get("files")
    if (plan.get("task") != "FEEDING_FOOD_20261102"
            or plan.get("releaseRoot") != str(PREVIOUS_RELEASE_ROOT)
            or not isinstance(expected_files, dict) or plan.get("links") != {}):
        raise Refusal("previous release manifest task/root/inventory mismatch")
    if PREVIOUS_RELEASE.is_symlink() or not PREVIOUS_RELEASE.is_dir():
        raise Refusal("previous immutable release is missing or linked")
    actual = inventory(PREVIOUS_RELEASE)
    for name, expected in expected_files.items():
        path = relative(name)
        safe_name(path)
        if actual.get(name) != expected:
            raise Refusal(f"previous frozen release file changed: {name}")
    extras = set(actual) - set(expected_files)
    for name in extras:
        if not (name.startswith("web/.next/cache/") or name.startswith("web/data/")):
            raise Refusal(f"unrecognized file in previous frozen release: {name}")
    if len([name for name in expected_files if name.startswith("web/node_modules/")]) != 9893:
        raise Refusal("previous release dependency inventory count changed")
    return plan, actual


def validate_exact_data_subtree(root: Path, relative_root: str, expected_files: dict[str, str]) -> None:
    folder = root / relative_root
    if not folder.exists() and not folder.is_symlink():
        return
    if folder.is_symlink() or not folder.is_dir():
        raise Refusal(f"standalone public subtree is linked or not a directory: {relative_root}")
    actual: dict[str, str] = {}
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(root).as_posix()
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise Refusal(f"standalone public subtree contains a symlink: {rel}")
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode):
            raise Refusal(f"standalone public subtree contains an unexpected entry: {rel}")
        safe_name(PurePosixPath(rel))
        actual[path.relative_to(folder).as_posix()] = file_hash(path)
    if actual != expected_files:
        raise Refusal(f"standalone {relative_root} file set differs from its pinned public files")


def validate_standalone(root: Path, source_files: dict[str, str]) -> None:
    if root.is_symlink() or not root.is_dir():
        raise Refusal("Next standalone output is missing or linked")
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        name = rel.as_posix()
        if name == "node_modules":
            if not path.is_symlink() or os.readlink(path) != str(PREVIOUS_BUILD_SOURCE / "node_modules"):
                raise Refusal("standalone node_modules must be the exact known build dependency link")
            target = PREVIOUS_BUILD_SOURCE / "node_modules"
            if target.is_symlink() or not target.is_dir():
                raise Refusal("known build dependency link target is missing or linked")
            continue
        safe_name(PurePosixPath(name))
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise Refusal(f"unexpected standalone symlink: {name}")
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise Refusal(f"unexpected standalone filesystem entry: {name}")
    for required in ("server.js", ".next/BUILD_ID"):
        if not (root / required).is_file() or (root / required).is_symlink():
            raise Refusal(f"standalone runtime file is missing: {required}")
    public_files = {
        name.removeprefix("public/"): digest
        for name, digest in source_files.items()
        if name.startswith("public/")
    }
    data_files = {name: source_files["data/" + name] for name in CATALOGS}
    validate_exact_data_subtree(root, "public", public_files)
    validate_exact_data_subtree(root, "data", data_files)


def copy_public_files(source_files: dict[str, str], web: Path) -> int:
    public_names = sorted(name for name in source_files if name.startswith("public/"))
    if not public_names:
        raise Refusal("public source files are absent from task source manifest")
    for name in public_names:
        item = checked_file(SOURCE, name)
        destination = web.joinpath(*relative("web/" + name).parts[1:])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)
        if file_hash(destination) != source_files[name]:
            raise Refusal(f"copied public asset hash changed: {name}")
    return len(public_names)


def copy_tree_checked(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise Refusal(f"build output tree is missing or linked: {source}")
    inventory(source, allow_sdk=False)
    shutil.copytree(source, destination, symlinks=False, dirs_exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    if STAGING.exists() or STAGING.is_symlink():
        raise Refusal("staging already exists; preserving it")
    source_manifest, source_digest = validate_source_evidence()
    previous_manifest, previous_files = load_previous_release()
    if file_hash(BASE_LAUNCHER) != BASE_LAUNCHER_SHA256:
        raise Refusal("current public launcher differs from the reviewed prior release")

    build_id_path = SOURCE / ".next/BUILD_ID"
    standalone_build_id = STANDALONE / ".next/BUILD_ID"
    if file_hash(build_id_path) != file_hash(standalone_build_id):
        raise Refusal("standalone BUILD_ID does not match the staged source build")
    build_id = standalone_build_id.read_text(encoding="utf-8").strip()
    if not build_id or len(build_id) > 128:
        raise Refusal("Next BUILD_ID is invalid")
    validate_standalone(STANDALONE, source_manifest["sourceFiles"])

    STAGING.mkdir(mode=0o755)
    web = STAGING / "web"
    shutil.copytree(STANDALONE, web, symlinks=True)
    node_modules = web / "node_modules"
    if not node_modules.is_symlink() or os.readlink(node_modules) != str(PREVIOUS_BUILD_SOURCE / "node_modules"):
        raise Refusal("copied standalone dependency link changed unexpectedly")
    node_modules.unlink()

    static = SOURCE / ".next/static"
    copy_tree_checked(static, web / ".next/static")
    source_files = source_manifest["sourceFiles"]
    public_count = copy_public_files(source_files, web)

    data_root = SOURCE / "data"
    if data_root.is_symlink() or not data_root.is_dir():
        raise Refusal("public catalog source directory is missing or linked")
    actual_catalogs = {path.name for path in data_root.iterdir()}
    if actual_catalogs != set(CATALOGS):
        raise Refusal("catalog source directory contains unknown or missing entries")
    data_dest = web / "data"
    data_dest.mkdir(mode=0o755, exist_ok=True)
    for name in CATALOGS:
        source_name = "data/" + name
        source_file = checked_file(SOURCE, source_name)
        if source_files.get(source_name) != file_hash(source_file):
            raise Refusal(f"catalog does not match the pinned source manifest: {name}")
        shutil.copy2(source_file, data_dest / name)
        if file_hash(data_dest / name) != source_files[source_name]:
            raise Refusal(f"copied catalog hash changed: {name}")

    old_deps = PREVIOUS_RELEASE / "web/node_modules"
    if old_deps.is_symlink() or not old_deps.is_dir():
        raise Refusal("verified previous release dependencies are missing or linked")
    shutil.copytree(old_deps, node_modules, symlinks=False)
    shutil.copyfile(BASE_LAUNCHER, STAGING / "launch-web.py")
    if file_hash(STAGING / "launch-web.py") != BASE_LAUNCHER_SHA256:
        raise Refusal("copied launcher hash changed")
    final_files = inventory(STAGING)
    expected_deps = {
        name: digest for name, digest in previous_manifest["files"].items()
        if name.startswith("web/node_modules/")
    }
    staged_deps = {
        name: digest for name, digest in final_files.items()
        if name.startswith("web/node_modules/")
    }
    if staged_deps != expected_deps:
        raise Refusal("materialized dependencies differ from the verified previous release inventory")
    required = {
        "launch-web.py",
        "web/server.js",
        "web/.next/BUILD_ID",
        "web/.next/server/app/food/log/page.js",
        "web/node_modules/next/dist/esm/build/webpack/plugins/flight-manifest-plugin.js",
    }
    if not required <= set(final_files):
        raise Refusal("frozen package is missing route or Next webpack runtime files")
    if not (STAGING / "web/.next/server/app/food/log/page.js").is_file():
        raise Refusal("compiled food logging route is missing")
    links = [path for path in STAGING.rglob("*") if path.is_symlink()]
    if links:
        raise Refusal("frozen package contains symlinks")
    print(json.dumps({
        "task": TASK,
        "staging": str(STAGING),
        "webBuildId": build_id,
        "sourceManifestSha256": source_digest,
        "previousReleaseManifestSha256": PREVIOUS_RELEASE_DIGEST,
        "files": len(final_files),
        "publicAssetsCopied": public_count,
        "catalogs": len(CATALOGS),
        "dependenciesCopied": len(expected_deps),
        "links": 0,
    }, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Refusal as exc:
        raise SystemExit(f"REFUSED: {exc}") from exc

#!/usr/bin/env bash
# AiArchive / data/archive/ 保留清理（手动运行，不设调度）：
#   bash scripts/prune-ai-archive.sh --days 90            # 删除 90 天前的归档行 + 孤儿文件
#   bash scripts/prune-ai-archive.sh --days 90 --dry-run  # 只统计不删除
#   DATABASE_URL=file:/path/app.db bash scripts/prune-ai-archive.sh --days 30
# 安全规则：
# - 被 AiJob.inputArchiveId 引用的行永不删除（审计链完整）
# - 只删除 data/archive/ 下且已无 DB 行引用的文件
set -euo pipefail

DAYS=90
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days=*) DAYS="${1#--days=}" ;;
    --days) DAYS="${2:?--days 需要天数}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（--help 查看）" >&2; exit 1 ;;
  esac
  shift
done

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 7 ]; then
  echo "❌ --days 必须为 ≥7 的整数" >&2; exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 需要 python3（标准库即可）" >&2; exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${DATABASE_URL:-file:./dev.db}"
case "$DB_URL" in
  file:*) DB_PATH="$REPO_ROOT/${DB_URL#file:}" ;;
  *) echo "❌ 仅支持 file: 数据库（当前 $DB_URL）" >&2; exit 1 ;;
esac
[ -f "$DB_PATH" ] || { echo "❌ 数据库不存在: $DB_PATH" >&2; exit 1; }

export REPO_ROOT DB_PATH DAYS DRY_RUN
python3 <<'PY'
import os, sqlite3, time
from datetime import datetime, timezone

db_path = os.environ["DB_PATH"]
days = int(os.environ["DAYS"])
dry = os.environ["DRY_RUN"] == "1"
cutoff = time.time() - days * 86400

def parse_ts(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        # 毫秒/秒时间戳自适应
        return v / 1000 if v > 1e12 else v
    s = str(v).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).timestamp()
    except ValueError:
        return None

db = sqlite3.connect(db_path, timeout=60)
db.execute("PRAGMA busy_timeout=60000")

referenced = {r[0] for r in db.execute("SELECT inputArchiveId FROM AiJob WHERE inputArchiveId IS NOT NULL")}
old_rows = []
for row_id, kind, fpath, created in db.execute("SELECT id, kind, filePath, createdAt FROM AiArchive"):
    ts = parse_ts(created)
    if ts is not None and ts < cutoff and kind != "output_error" and row_id not in referenced:
        old_rows.append((row_id, kind, fpath))
print(f"[prune] AiArchive rows older than {days}d (excluding referenced & output_error): {len(old_rows)}")

arch_root = os.path.join(os.environ["REPO_ROOT"], "data", "archive")
removed_files = 0
if not dry and old_rows:
    ids = [r[0] for r in old_rows]
    for i in range(0, len(ids), 500):
        db.execute(f"DELETE FROM AiArchive WHERE id IN ({','.join('?' * len(ids[i:i+500]))})", ids[i:i+500])
    db.commit()

# 孤儿文件：data/archive 下存在、但无任何 AiArchive 行引用的文件
if os.path.isdir(arch_root):
    live = {r[0] for r in db.execute("SELECT filePath FROM AiArchive WHERE filePath IS NOT NULL")}
    for dirpath, _, files in os.walk(arch_root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), os.environ["REPO_ROOT"])
            if rel not in live:
                print(f"[prune] orphan file: {rel}")
                removed_files += 1
                if not dry:
                    os.remove(os.path.join(dirpath, f))
print(f"[prune] orphan files: {removed_files}" + (" (dry-run, 未删除)" if dry else ""))
db.close()
PY

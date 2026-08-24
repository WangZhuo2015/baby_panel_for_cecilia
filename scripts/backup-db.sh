#!/usr/bin/env bash
# SQLite 数据库安全备份：WAL 一致性快照 + 保留最近 N 份
# 依赖: python3 (标准库 sqlite3)；产物权限 600
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 需要 python3（标准库即可），未找到" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-$REPO_ROOT/dev.db}"
# 先解析为绝对路径，再做任何 cd，避免相对路径被错误重锚定
case "$DB" in
  /*) ;;
  *) DB="$PWD/$DB" ;;
esac

DEST_DIR="$REPO_ROOT/backups"
KEEP=14

if [ ! -f "$DB" ]; then
  echo "❌ 数据库不存在: $DB" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
DEST="$DEST_DIR/$(basename "${DB%.db}")_${TS}.db"

python3 - "$DB" "$DEST" <<'PY'
import sqlite3, sys
src_path, dest_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dest_path)
with dst:
    src.backup(dst)
src.close(); dst.close()
# 快照完整性自检
chk = sqlite3.connect(dest_path).execute("PRAGMA quick_check").fetchone()[0]
assert chk == "ok", f"备份自检失败: {chk}"
PY

chmod 600 "$DEST"

# 按文件名排序保留最近 KEEP 份（文件名内嵌时间戳，避免 mtime 时钟回拨误删）
ls -1 "$DEST_DIR"/"$(basename "${DB%.db}")_"*.db 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm --

echo "✅ 已备份: $DEST"

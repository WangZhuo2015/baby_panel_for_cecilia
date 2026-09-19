#!/usr/bin/env bash
# SQLite 数据库安全备份：WAL 一致性快照 + 保留最近 N 份
# 依赖: python3 (标准库 sqlite3)；产物权限 600
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 需要 python3（标准库即可），未找到" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -n "${1:-}" ]; then
  DB="$1"
elif [ -n "${DATABASE_URL:-}" ]; then
  # 支持从环境变量 DATABASE_URL 解析数据库路径（如测试环境 file:./dev_test.db）
  DB_RAW="${DATABASE_URL#file:}"
  DB_RAW="${DB_RAW%%\?*}"
  if [ -f "$DB_RAW" ]; then
    DB="$DB_RAW"
  elif [ -f "$REPO_ROOT/$DB_RAW" ]; then
    DB="$REPO_ROOT/$DB_RAW"
  elif [ -f "$REPO_ROOT/prod.db" ]; then
    DB="$REPO_ROOT/prod.db"
  else
    DB="$REPO_ROOT/dev.db"
  fi
elif [ -f "$REPO_ROOT/prod.db" ]; then
  DB="$REPO_ROOT/prod.db"
else
  DB="$REPO_ROOT/dev.db"
fi
# 先解析为绝对路径，再做任何 cd，避免相对路径被错误重锚定
case "$DB" in
  /*) ;;
  *) DB="$PWD/$DB" ;;
esac

DEST_DIR="$REPO_ROOT/backups"
KEEP="${BACKUP_KEEP:-14}"

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
PRUNE_TARGETS=$(ls -1 "$DEST_DIR"/"$(basename "${DB%.db}")_"*.db 2>/dev/null | sort | head -n -"$KEEP" || true)
if [ -n "$PRUNE_TARGETS" ]; then
  echo "$PRUNE_TARGETS" | while IFS= read -r f; do
    if [ -n "$f" ] && [ -f "$f" ]; then
      rm -f "$f"
      echo "🧹 清理过期历史备份: $(basename "$f")"
    fi
  done
fi

TOTAL_COUNT=$(ls -1 "$DEST_DIR"/"$(basename "${DB%.db}")_"*.db 2>/dev/null | wc -l)
FILE_SIZE=$(du -h "$DEST" | cut -f1)

echo "✅ 已备份: $DEST ($FILE_SIZE)，当前库保留 ${TOTAL_COUNT} 份快照 (保留上限: 最近 ${KEEP} 份)"

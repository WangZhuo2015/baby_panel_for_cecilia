#!/usr/bin/env bash
# SQLite 数据库安全回档/恢复脚本
# 用法:
#   bash scripts/restore-db.sh [备份文件路径] [目标数据库路径]
#   默认恢复 backups/rollback_checkpoint.db 或最新的备份文件到 dev.db
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"

# 确定源备份文件
if [ -n "${1:-}" ]; then
  SRC="$1"
elif [ -f "$BACKUP_DIR/rollback_checkpoint.db" ]; then
  SRC="$BACKUP_DIR/rollback_checkpoint.db"
else
  SRC="$(ls -1t "$BACKUP_DIR"/dev_*.db 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  echo "❌ 未找到可用的备份文件: ${SRC:-$BACKUP_DIR}" >&2
  exit 1
fi

case "$SRC" in
  /*) ;;
  *) SRC="$PWD/$SRC" ;;
esac

# 确定目标数据库
TARGET="${2:-$REPO_ROOT/dev.db}"
case "$TARGET" in
  /*) ;;
  *) TARGET="$PWD/$TARGET" ;;
esac

echo "🔄 准备回档数据库..."
echo "  源备份文件: $SRC"
echo "  目标数据库: $TARGET"

# 1. 验证源备份完整性
if ! python3 - "$SRC" <<'PY'
import sqlite3, sys
src = sys.argv[1]
chk = sqlite3.connect(f"file:{src}?mode=ro", uri=True).execute("PRAGMA quick_check").fetchone()[0]
assert chk == "ok", f"备份完整性检查未通过: {chk}"
PY
then
  echo "❌ 源备份文件损坏或无效，终止回档！" >&2
  exit 1
fi

# 2. 如果目标数据库存在，先做一次安全快照（防止误操作）
if [ -f "$TARGET" ]; then
  PRE_RESTORE="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).db"
  echo "📦 正在生成回档前安全保护快照: $(basename "$PRE_RESTORE")"
  python3 - "$TARGET" "$PRE_RESTORE" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
try:
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    with d:
        s.backup(d)
    s.close(); d.close()
except Exception as e:
    print(f"Warning: could not backup existing target: {e}", file=sys.stderr)
PY
fi

# 3. 清理目标 WAL / SHM 文件（关键：避免旧 WAL 脏页污染新恢复的数据库）
rm -f "${TARGET}-wal" "${TARGET}-shm"

# 4. 复制备份文件至目标位置
cp -f "$SRC" "$TARGET"
chmod 600 "$TARGET"

# 5. 校验恢复后的数据库
python3 - "$TARGET" <<'PY'
import sqlite3, sys
tgt = sys.argv[1]
con = sqlite3.connect(tgt)
chk = con.execute("PRAGMA quick_check").fetchone()[0]
assert chk == "ok", f"恢复后自检失败: {chk}"
con.execute("PRAGMA journal_mode = WAL;")
con.execute("PRAGMA foreign_keys = ON;")
con.close()
PY

echo "✅ 数据库已成功回档/恢复完成！"

#!/usr/bin/env bash
# 快速切换数据库配置并重启服务
# 用法:
#   bash scripts/switch-db.sh [temp|dev|自定义文件名]
# 示例:
#   bash scripts/switch-db.sh temp   # 切到 temp.db
#   bash scripts/switch-db.sh dev    # 切回 dev.db
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TARGET_MODE="${1:-toggle}"

CURRENT_URL=$(grep -E "^DATABASE_URL=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' || echo "file:./dev.db")

if [ "$TARGET_MODE" = "toggle" ]; then
  if [[ "$CURRENT_URL" =~ temp\.db$ ]]; then
    TARGET_MODE="dev"
  else
    TARGET_MODE="temp"
  fi
fi

if [ "$TARGET_MODE" = "temp" ]; then
  TARGET_DB="temp.db"
elif [ "$TARGET_MODE" = "dev" ]; then
  TARGET_DB="dev.db"
else
  TARGET_DB="$TARGET_MODE"
fi

TARGET_URL="file:./$TARGET_DB"

# 确保目标数据库文件存在
if [ ! -f "$REPO_ROOT/$TARGET_DB" ]; then
  if [ "$TARGET_DB" = "temp.db" ] && [ -f "$REPO_ROOT/backups/rollback_checkpoint.db" ]; then
    echo "📦 从回档点初始化 temp.db..."
    cp -p "$REPO_ROOT/backups/rollback_checkpoint.db" "$REPO_ROOT/temp.db"
    chmod 600 "$REPO_ROOT/temp.db"
    rm -f "$REPO_ROOT/temp.db-wal" "$REPO_ROOT/temp.db-shm"
  elif [ -f "$REPO_ROOT/dev.db" ]; then
    echo "📦 从 dev.db 复制创建 $TARGET_DB..."
    python3 - "$REPO_ROOT/dev.db" "$REPO_ROOT/$TARGET_DB" <<'PY'
import sqlite3, sys
s = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
d = sqlite3.connect(sys.argv[2])
with d: s.backup(d)
s.close(); d.close()
PY
    chmod 600 "$REPO_ROOT/$TARGET_DB"
  else
    echo "❌ 目标数据库文件不存在: $TARGET_DB" >&2
    exit 1
  fi
fi

# 更新 .env
sed -i -E "s|^DATABASE_URL=.*|DATABASE_URL=\"$TARGET_URL\"|" "$ENV_FILE"

echo "🔀 已将 .env 中 DATABASE_URL 切换为: $TARGET_URL"

# 重启 baby-panel 服务
if systemctl is-active --quiet baby-panel 2>/dev/null; then
  echo "🔄 正在重启 baby-panel 服务..."
  sudo systemctl restart baby-panel
  echo "✅ baby-panel 服务已重启生效！"
else
  echo "ℹ️ baby-panel 服务未运行，修改已保存到 .env"
fi


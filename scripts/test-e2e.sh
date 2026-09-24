#!/usr/bin/env bash
# E2E 冒烟测试一键运行：
#   独立测试库 dev_test.db + 3089 服务 → 跑 Playwright E2E → 自清理 → 关服务。
# 用法：bash scripts/test-e2e.sh [PORT]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f "$REPO_ROOT/.env.test" ]; then
  set -a
  source "$REPO_ROOT/.env.test"
  set +a
fi

PORT="${1:-${PORT:-3089}}"
export DATABASE_URL="${DATABASE_URL:-file:./dev_test.db}"
export PORT
export BABY_PANEL_URL="http://127.0.0.1:${PORT}"

echo "==> [test-e2e] migrate deploy ($DATABASE_URL)"
npx prisma migrate deploy

echo "==> [test-e2e] seed static reference data"
npx tsx prisma/seed.ts

echo "==> [test-e2e] purge leftover test tenants"
npx tsx scripts/purge-test-data.ts

# 预检：端口被占（常见为生产服务）必须直接失败，避免测试打到生产环境
if (echo > /dev/tcp/127.0.0.1/"${PORT}") 2>/dev/null; then
  echo "[test-e2e] 端口 ${PORT} 已被占用，拒绝运行，请换端口重试或关闭占用进程"
  exit 1
fi

if command -v setsid >/dev/null 2>&1; then
  setsid npx next dev --port "${PORT}" > /tmp/baby-test-server.log 2>&1 &
else
  npx next dev --port "${PORT}" > /tmp/baby-test-server.log 2>&1 &
fi
SERVER_PID=$!
cleanup() {
  echo "==> [test-e2e] cleaning up test server and data..."
  kill -- -"$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  pkill -f "next-server.*--port ${PORT}" 2>/dev/null || true
  npx tsx scripts/purge-test-data.ts 2>/dev/null || true
}
trap cleanup EXIT

echo "==> [test-e2e] wait for server on :${PORT}"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/api/app-config"; then
    break
  fi
  if [ "$i" = 60 ]; then
    echo "[test-e2e] server boot timeout, log tail:"
    tail -20 /tmp/baby-test-server.log
    exit 1
  fi
  sleep 2
done

echo "==> [test-e2e] run playwright tests"
npx playwright test

echo "==> [test-e2e] E2E tests finished successfully"

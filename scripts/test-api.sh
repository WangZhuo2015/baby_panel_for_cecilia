#!/usr/bin/env bash
# API 集成测试一键运行：
#   独立测试库 dev_test.db + 3089 临时服务 → 跑 tests/api → 自清理 → 关服务。
# 用法：bash scripts/test-api.sh [PORT]
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
export NODE_ENV="test"

# Refuse unsafe targets before migrations or seeding can run.
api_test_database_path="${DATABASE_URL#file:}"
if [[ "$DATABASE_URL" != file:* ]] || [ "${api_test_database_path##*/}" != "dev_test.db" ]; then
  echo "[test-api] 拒绝非隔离测试库；DATABASE_URL 必须指向 dev_test.db" >&2
  exit 1
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" = "3088" ]; then
  echo "[test-api] 测试端口无效或为生产端口 3088，拒绝运行" >&2
  exit 1
fi

echo "==> [test-api] migrate deploy ($DATABASE_URL)"
npx prisma migrate deploy

echo "==> [test-api] seed static reference data"
node --import tsx prisma/seed.ts

echo "==> [test-api] purge leftover test tenants"
node --import tsx scripts/purge-test-data.ts

# 预检：端口被占（常见为生产服务）必须直接失败，否则测试会打到错误服务上
if (echo > /dev/tcp/127.0.0.1/"${PORT}") 2>/dev/null; then
  echo "[test-api] 端口 ${PORT} 已被占用（可能是生产服务），拒绝运行，换端口重试：bash scripts/test-api.sh 3089"
  exit 1
fi

echo "==> [test-api] start server on :${PORT}"
if command -v setsid >/dev/null 2>&1; then
  setsid npx next dev --hostname 127.0.0.1 --port "${PORT}" > /tmp/baby-test-server.log 2>&1 &
else
  npx next dev --hostname 127.0.0.1 --port "${PORT}" > /tmp/baby-test-server.log 2>&1 &
fi
SERVER_PID=$!
cleanup() {
  kill -- -"$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  pkill -f "next-server.*--port ${PORT}" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> [test-api] wait for server"
for i in $(seq 1 60); do
  if curl --max-time 3 -sf -o /dev/null "http://127.0.0.1:${PORT}/api/app-config"; then
    break
  fi
  if [ "$i" = 60 ]; then
    echo "[test-api] server boot timeout, log tail:"
    tail -20 /tmp/baby-test-server.log
    exit 1
  fi
  sleep 2
done

echo "==> [test-api] run api tests (sequential: files share one SQLite file)"
TEST_EXIT=0
api_test_files=(tests/api/*.test.ts)
if [ -n "${TEST_API_FILES:-}" ]; then
  read -r -a api_test_files <<< "$TEST_API_FILES"
  for test_path in "${api_test_files[@]}"; do
    if [[ ! "$test_path" =~ ^tests/api/[A-Za-z0-9._-]+\.test\.ts$ ]] || [ ! -f "$test_path" ]; then
      echo "[test-api] 非法或不存在的测试文件: $test_path" >&2
      exit 1
    fi
  done
fi
for f in "${api_test_files[@]}"; do
  echo "---- $f"
  if ! node --import tsx --env-file=.env.test --test "$f"; then
    TEST_EXIT=1
  fi
done

echo "==> [test-api] purge test tenants"
node --import tsx scripts/purge-test-data.ts

exit "$TEST_EXIT"

#!/usr/bin/env bash
# E2E 冒烟测试一键运行：
#   独立测试库 dev_test.db + 3089 服务 → 跑 Playwright E2E → 自清理 → 关服务。
# 用法：bash scripts/test-e2e.sh [PORT]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/test-server-common.sh
source scripts/test-server-common.sh
load_test_server_env test-e2e "${@:1:1}"

echo "==> [test-e2e] migrate deploy ($DATABASE_URL)"
npx prisma migrate deploy

echo "==> [test-e2e] seed static reference data"
npx tsx prisma/seed.ts

echo "==> [test-e2e] purge leftover test tenants"
npx tsx scripts/purge-test-data.ts

cleanup() {
  echo "==> [test-e2e] cleaning up test server and data..."
  stop_test_server
  npx tsx scripts/purge-test-data.ts 2>/dev/null || true
}
trap cleanup EXIT
start_test_server

echo "==> [test-e2e] wait for server on :${PORT}"
wait_for_test_server test-e2e

echo "==> [test-e2e] run playwright tests"
npx playwright test

echo "==> [test-e2e] E2E tests finished successfully"

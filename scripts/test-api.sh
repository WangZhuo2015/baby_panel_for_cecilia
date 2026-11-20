#!/usr/bin/env bash
# API 集成测试一键运行：
#   独立测试库 dev_test.db + 3089 临时服务 → 跑 tests/api → 自清理 → 关服务。
# 用法：bash scripts/test-api.sh [PORT] [tests/api/example.test.ts ...]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/test-server-common.sh
source scripts/test-server-common.sh
load_test_server_env test-api "${@:1:1}"

if [ "$#" -gt 0 ]; then shift; fi
TEST_FILES=("$@")
if [ "${#TEST_FILES[@]}" -eq 0 ]; then TEST_FILES=(tests/api/*.test.ts); fi
for f in "${TEST_FILES[@]}"; do
  if [[ "$f" != tests/api/*.test.ts || "$f" == *".."* || ! -f "$f" ]]; then
    echo "[test-api] 测试文件必须是现有 tests/api/*.test.ts 文件：$f"
    exit 1
  fi
done
echo "==> [test-api] migrate deploy ($DATABASE_URL)"
npx prisma migrate deploy

echo "==> [test-api] seed static reference data"
node --import tsx prisma/seed.ts

echo "==> [test-api] purge leftover test tenants"
node --import tsx scripts/purge-test-data.ts

echo "==> [test-api] start server on :${PORT}"
trap stop_test_server EXIT
start_test_server

echo "==> [test-api] wait for server"
wait_for_test_server test-api

echo "==> [test-api] run api tests (sequential: files share one SQLite file)"
TEST_EXIT=0
for f in "${TEST_FILES[@]}"; do
  echo "---- $f"
  if ! node --import tsx --test "$f"; then
    TEST_EXIT=1
  fi
done

echo "==> [test-api] purge test tenants"
node --import tsx scripts/purge-test-data.ts

exit "$TEST_EXIT"

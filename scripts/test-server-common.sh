# Shared by the API and E2E test runners after changing to the repository root.

load_test_server_env() {
  local entry
  local -a test_exports=()
  while IFS= read -r -d '' entry; do
    # The empty record marks successful completion of the preflight.
    if [[ -z "$entry" ]]; then
      export "${test_exports[@]}"
      return
    fi
    test_exports+=("$entry")
  done < <(node scripts/test-server-preflight.mjs "$@")
  return 1
}

start_test_server() {
  SERVER_LOG="$(mktemp /tmp/baby-test-server.XXXXXX.log)"
  local next=(node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port "$PORT")
  if command -v setsid >/dev/null 2>&1; then
    setsid "${next[@]}" > "$SERVER_LOG" 2>&1 &
  else
    "${next[@]}" > "$SERVER_LOG" 2>&1 &
  fi
  SERVER_PID=$!
}

wait_for_test_server() {
  local runner="$1"
  local attempt
  for ((attempt = 0; attempt < 60; attempt++)); do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "[$runner] 测试服务退出，日志末尾如下：" >&2
      tail -20 "$SERVER_LOG" >&2
      return 1
    fi
    # Only probe HTTP after this Next process has successfully bound the port.
    if grep -q 'Ready in ' "$SERVER_LOG" && curl --noproxy '*' -sf -o /dev/null "$TEST_BASE_URL/api/app-config"; then
      return
    fi
    sleep 2
  done
  echo "[$runner] 等待测试服务启动超时，日志末尾如下：" >&2
  tail -20 "$SERVER_LOG" >&2
  return 1
}

stop_test_server() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill -- -"$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_LOG:-}" ]]; then
    rm -f -- "$SERVER_LOG"
  fi
}

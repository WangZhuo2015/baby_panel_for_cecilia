export function getTestServerUrl(): string {
  const value = process.env.TEST_BASE_URL || process.env.BABY_PANEL_URL || "";
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  if (!match || match[0] !== value || Number(match[1]) > 65535 || match[1] === "3088") {
    throw new Error("需要独立的本地测试服务，请通过 scripts/test-api.sh 或 scripts/test-e2e.sh 运行");
  }
  return value;
}

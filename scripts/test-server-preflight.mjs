import { lstatSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import dotenv from "dotenv";

const [runner, requestedPort] = process.argv.slice(2);
const host = "127.0.0.1";

try {
  const testEnvFile = ".env.test";
  let env;
  try {
    env = dotenv.parse(readFileSync(testEnvFile));
  } catch {
    throw new Error("需要可读取的 .env.test（参照 .env.test.example）");
  }

  const databasePath = path.resolve("dev_test.db");
  const databaseUrl = env.DATABASE_URL ?? "";
  if (
    !databaseUrl.startsWith("file:") ||
    databaseUrl.startsWith("file://") ||
    /[%?#\\\x00-\x1F\x7F]/.test(databaseUrl) ||
    path.resolve(databaseUrl.slice("file:".length)) !== databasePath
  ) {
    throw new Error(".env.test 的 DATABASE_URL 必须指向仓库根目录的 dev_test.db");
  }

  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    const file = lstatSync(`${databasePath}${suffix}`, { throwIfNoEntry: false });
    if (file && (!file.isFile() || file.nlink !== 1)) {
      throw new Error(`dev_test.db${suffix} 必须是普通文件且不能是链接`);
    }
  }

  const port = requestedPort || env.PORT || "";
  if (!/^[1-9][0-9]{0,4}$/.test(port) || port.trim() !== port || Number(port) > 65535 || Number(port) === 3088) {
    throw new Error("请在 .env.test 或命令行指定有效测试端口（禁止使用生产端口 3088）");
  }

  if (env.NODE_ENV && env.NODE_ENV !== "test") {
    throw new Error(".env.test 的 NODE_ENV 必须为 test");
  }

  // lib/config.ts reloads .env.test in test mode, so the runtime test URL must be reserved.
  if (Object.hasOwn(env, "TEST_BASE_URL")) {
    throw new Error("TEST_BASE_URL 由测试启动脚本设置，请从 .env.test 移除该项");
  }

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => server.close(resolve));
  }).catch((error) => {
    throw new Error(`无法绑定测试地址 ${host}:${port}（${error.code ?? "未知原因"}）`);
  });

  const baseUrl = `http://${host}:${port}`;
  const testEnv = {
    ...env,
    DATABASE_URL: `file:${databasePath}`,
    NODE_ENV: "test",
    PORT: port,
    BABY_PANEL_URL: baseUrl,
    TEST_BASE_URL: baseUrl,
  };
  for (const [key, value] of Object.entries(testEnv)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || value.includes("\0")) {
      throw new Error(".env.test 包含无法导出的环境变量");
    }
  }
  process.stdout.write(Object.entries(testEnv).map(([key, value]) => `${key}=${value}\0`).join("") + "\0");
} catch (error) {
  console.error(`[${runner}] ${error.message}`);
  process.exitCode = 1;
}

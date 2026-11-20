import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("API and E2E runners reject unsafe test environments before migration", async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), "baby-test-server-preflight-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const runners = ["test-api.sh", "test-e2e.sh"];
  mkdirSync(join(fixture, "scripts"));
  for (const file of [...runners, "test-server-common.sh", "test-server-preflight.mjs"]) {
    copyFileSync(new URL(`../../scripts/${file}`, import.meta.url), join(fixture, "scripts", file));
  }

  mkdirSync(join(fixture, "node_modules"));
  symlinkSync(fileURLToPath(new URL("../../node_modules/dotenv", import.meta.url)), join(fixture, "node_modules", "dotenv"));
  mkdirSync(join(fixture, "tests", "api"), { recursive: true });
  writeFileSync(join(fixture, "tests", "api", "dummy.test.ts"), "");

  const bin = join(fixture, "bin");
  const mutationMarker = "migration-invoked";
  const markerPath = join(fixture, mutationMarker);
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), `#!/bin/sh\n: > ${mutationMarker}\nexit 91\n`, { mode: 0o755 });

  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => listener.close(() => resolve())));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  const configPath = join(fixture, ".env.test");
  const cases = [
    { name: "missing .env.test", config: null, error: /需要可读取的 \.env\.test/ },
    { name: "missing DATABASE_URL", config: `PORT=${address.port}\n`, error: /DATABASE_URL/ },
    { name: "wrong database", config: `DATABASE_URL=file:./prod.db\nPORT=${address.port}\n`, error: /DATABASE_URL/ },
    { name: "occupied port", config: `DATABASE_URL=file:./dev_test.db\nPORT=${address.port}\n`, error: /EADDRINUSE/ },
  ];

  for (const runner of runners) {
    for (const { name, config, error } of cases) {
      await t.test(`${runner}: ${name}`, () => {
        rmSync(markerPath, { force: true });
        if (config === null) rmSync(configPath, { force: true });
        else writeFileSync(configPath, config);

        const result = spawnSync("bash", [join("scripts", runner)], {
          cwd: fixture,
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH}`,
            DATABASE_URL: "file:./prod.db",
          },
          encoding: "utf8",
          timeout: 5_000,
        });

        assert.equal(result.error, undefined, result.error?.message);
        assert.equal(existsSync(markerPath), false, "reached the migration command");
        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stderr, error);
      });
    }
  }
});

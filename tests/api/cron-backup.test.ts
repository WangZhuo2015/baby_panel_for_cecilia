import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runDatabaseBackup } from "../../lib/cron/backup";
import { GET, POST } from "../../app/api/cron/backup/route";

test("Scheduled Database Backup & Cron Endpoint", async (t) => {
  const createdTestFiles: string[] = [];

  t.after(async () => {
    // Cleanup any test backup files generated during test execution
    for (const f of createdTestFiles) {
      try {
        await fs.unlink(f);
      } catch {}
    }
  });

  // 1. Test runDatabaseBackup directly in test environment
  console.log("-> Testing runDatabaseBackup runner with dev_test.db...");
  const backupResult = await runDatabaseBackup({ keep: 5 });
  assert.equal(backupResult.success, true, "Backup runner should succeed");
  assert.ok(backupResult.backupPath, "Backup path must exist");
  assert.ok(backupResult.backupFile?.startsWith("dev_test_"), "Must back up dev_test.db in test environment");
  assert.ok(backupResult.sizeBytes && backupResult.sizeBytes > 0, "Backup file size must be > 0");

  createdTestFiles.push(backupResult.backupPath!);

  // Verify file exists on disk and has chmod 600
  const stat = await fs.stat(backupResult.backupPath!);
  assert.ok(stat.isFile());
  // Mode 0o600 in octal is 33152 in decimal on Linux
  const perm = (stat.mode & 0o777).toString(8);
  assert.equal(perm, "600", "Backup file permissions must be 600");

  // 2. Test Cron API Route authorization
  console.log("-> Testing /api/cron/backup auth & trigger...");

  // 2a. External unauthorized request without secret -> 401
  const unauthReq = new Request("http://localhost:3000/api/cron/backup", {
    headers: {
      "x-forwarded-for": "203.0.113.1",
      Authorization: "Bearer invalid_secret",
    },
  });
  const unauthRes = await GET(unauthReq);
  assert.equal(unauthRes.status, 401, "External unauthorized request should return 401");

  // 2b. Localhost request (loopback allowed when no CRON_SECRET is set) -> 200
  const localReq = new Request("http://localhost:3000/api/cron/backup?keep=5", {
    headers: {
      "x-forwarded-for": "127.0.0.1",
    },
  });
  const localRes = await GET(localReq);
  assert.equal(localRes.status, 200, "Localhost request should return 200");
  const localData = await localRes.json();
  assert.equal(localData.success, true);
  assert.ok(localData.backupFile?.startsWith("dev_test_"));
  assert.ok(localData.sizeBytes > 0);

  const localBackupPath = path.resolve(process.cwd(), "backups", localData.backupFile);
  createdTestFiles.push(localBackupPath);

  // 2c. POST route test with localhost -> 200
  const postReq = new Request("http://localhost:3000/api/cron/backup", {
    method: "POST",
    headers: {
      "x-forwarded-for": "127.0.0.1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ keep: 5 }),
  });
  const postRes = await POST(postReq);
  assert.equal(postRes.status, 200, "POST request should return 200");
  const postData = await postRes.json();
  assert.equal(postData.success, true);
  assert.ok(postData.backupFile?.startsWith("dev_test_"));

  const postBackupPath = path.resolve(process.cwd(), "backups", postData.backupFile);
  createdTestFiles.push(postBackupPath);

  // 2d. Strict CRON_SECRET validation when configured
  const origCronSecret = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "test_cron_secret_key_999";

    // Rejection without secret even from loopback
    const loopbackWithoutSecretReq = new Request("http://localhost:3000/api/cron/backup", {
      headers: { "x-forwarded-for": "127.0.0.1" },
    });
    const loopbackRes = await GET(loopbackWithoutSecretReq);
    assert.equal(loopbackRes.status, 401, "Loopback without secret should be 401 when CRON_SECRET is set");

    // Acceptance with valid Bearer secret
    const authHeaderReq = new Request("http://localhost:3000/api/cron/backup", {
      headers: {
        Authorization: "Bearer test_cron_secret_key_999",
        "x-forwarded-for": "203.0.113.88",
      },
    });
    const authHeaderRes = await GET(authHeaderReq);
    assert.equal(authHeaderRes.status, 200, "Bearer secret request should return 200");
    const authData = await authHeaderRes.json();
    assert.equal(authData.success, true);
    if (authData.backupFile) {
      createdTestFiles.push(path.resolve(process.cwd(), "backups", authData.backupFile));
    }
  } finally {
    if (origCronSecret !== undefined) {
      process.env.CRON_SECRET = origCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  }
});

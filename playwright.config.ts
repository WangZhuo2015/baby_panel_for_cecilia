import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || "3089";
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1, // Single worker prevents SQLite dev_test.db locking contention
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `${BASE_URL}/api/app-config`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      DATABASE_URL: "file:./dev_test.db",
      PORT: PORT,
      NODE_ENV: "development",
    },
  },
});

import { test, expect } from "@playwright/test";

test.describe.serial("Baby Panel Core End-to-End Smoke Suite", () => {
  const shortId = Date.now().toString().slice(-4);
  const testUser = {
    username: `test_e2e_${shortId}`,
    password: "Password123!",
    displayName: `家长_${shortId}`,
    babyName: `test_b_${shortId}`,
  };

  test.afterAll(async () => {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx tsx scripts/purge-test-data.ts", { stdio: "ignore" });
    } catch {
      // Ignored if run in restricted context
    }
  });

  test("1. User registration & Baby Onboarding -> Dashboard verification", async ({ page }) => {
    // 1.1 Go to registration page
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "加入宝宝成长工作台" })).toBeVisible();

    // 1.2 Fill registration form
    await page.getByPlaceholder("英文字母或数字，如 yeye123").fill(testUser.username);
    await page.getByPlaceholder("请设置 8 位及以上密码").fill(testUser.password);

    // 1.3 Submit registration
    await page.getByRole("button", { name: "创建账号与家庭空间" }).click();

    // 1.4 Should redirect to /onboarding for new family
    await expect(page).toHaveURL(/.*\/onboarding/, { timeout: 15_000 });
    await expect(page.getByPlaceholder("如：糖糖、果果、安安…")).toBeVisible();

    // 1.5 Fill baby profile
    await page.getByPlaceholder("如：糖糖、果果、安安…").fill(testUser.babyName);

    // Click submit button (labeled "开始使用" for new baby)
    const submitBtn = page.getByRole("button", { name: "开始使用" });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 1.6 Share modal should appear: "进入今日看板开始记录"
    const enterDashboardBtn = page.getByRole("button", { name: "进入今日看板开始记录" });
    await expect(enterDashboardBtn).toBeVisible({ timeout: 15_000 });
    await enterDashboardBtn.click();

    // 1.7 Verify landing on main dashboard /
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/?$/, { timeout: 15_000 });
    await expect(page.getByText(testUser.babyName).first()).toBeVisible({ timeout: 10_000 });
  });

  test("2. Core record creation & timeline instantaneous rendering", async ({ page }) => {
    // 2.1 Login with the created test account
    await page.goto("/login");
    await page.getByPlaceholder("请输入用户名").fill(testUser.username);
    await page.getByPlaceholder("请输入密码").fill(testUser.password);
    await page.getByRole("button", { name: "登 录" }).click();

    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/?$/, { timeout: 15_000 });
    await expect(page.getByText(testUser.babyName).first()).toBeVisible({ timeout: 10_000 });

    // 2.2 Navigate to /records/diaper
    await page.goto("/records/diaper");
    await expect(page.getByRole("heading", { name: "尿布记录" })).toBeVisible();

    // 2.3 Fill note and submit
    const noteInput = page.getByPlaceholder("记录一下宝宝臀部情况或特殊细节...");
    await noteInput.fill("E2E自动化测试尿布排便记录");

    const saveBtn = page.getByRole("button", { name: "保存记录" });
    await expect(saveBtn).toBeEnabled({ timeout: 15_000 });
    await saveBtn.click();

    // 2.4 Should redirect back to dashboard and render timeline
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/?$/, { timeout: 15_000 });
    await expect(page.getByText("E2E自动化测试尿布排便记录").first()).toBeVisible({ timeout: 10_000 });
  });

  test("3. Daily summary dashboard & Poster modal export interaction", async ({ page }) => {
    // 3.1 Login with the created test account
    await page.goto("/login");
    await page.getByPlaceholder("请输入用户名").fill(testUser.username);
    await page.getByPlaceholder("请输入密码").fill(testUser.password);
    await page.getByRole("button", { name: "登 录" }).click();

    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/?$/, { timeout: 15_000 });

    // 3.2 Navigate to /daily-summary
    await page.goto("/daily-summary");
    await expect(page.getByText(testUser.babyName).first()).toBeVisible({ timeout: 10_000 });

    // 3.3 Click "生成海报" button
    const posterBtn = page.getByRole("button", { name: "生成海报" }).first();
    await expect(posterBtn).toBeVisible();
    await posterBtn.click();

    // 3.4 Verify poster modal opens and displays "保存高清海报 (PNG)"
    await expect(page.getByText("保存高清海报 (PNG)")).toBeVisible({ timeout: 10_000 });

    // Close poster modal
    const closeBtn = page.getByTitle("关闭海报");
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await expect(page.getByText("保存高清海报 (PNG)")).not.toBeVisible();
    }
  });
});

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = '/home/ubuntu/.gemini/antigravity-cli/brain/082ceda1-77b5-44c5-8005-cbde390c17b1/scratch/visual-qa';
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = 'http://127.0.0.1:3088';

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  // 1. 无邀请码注册页面
  console.log('Navigating to Register page...');
  await page.goto(`${baseUrl}/register`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '01-register-page-clean.png'), fullPage: true });

  // 2. 注册一个测试账号并在 UI 中完成登录进入家庭页
  console.log('Creating test user via UI...');
  const testUser = `test_yeye_${Date.now()}`;
  await page.fill('input[placeholder*="mama123"], input[placeholder*="yeye123"]', testUser);
  await page.fill('input[type="password"]', 'Password123!');
  await page.click('text=爷爷');
  await page.click('button:has-text("创建账号与家庭空间")');
  await page.waitForTimeout(1500);

  // 此时新用户无宝宝，跳转到了 /onboarding，截取无邀请码用户的多出一步：添加宝宝
  console.log('Taking screenshot of onboarding step...');
  await page.screenshot({ path: path.join(outDir, '05-onboarding-baby-setup.png'), fullPage: true });

  // 填入宝宝信息并保存
  await page.fill('input[placeholder*="糖糖"]', '小团子');
  await page.click('button:has-text("开始使用")');
  await page.waitForTimeout(1200);

  // 截取建档完成弹窗（展示专属邀请链接与通知推荐）
  console.log('Taking screenshot of FamilyCreatedShareModal...');
  await page.screenshot({ path: path.join(outDir, '06-family-created-share-modal.png') });

  // 点击关闭/进入看板
  const enterBtn = await page.$('text=进入今日看板开始记录');
  if (enterBtn) await enterBtn.click();
  await page.waitForTimeout(1000);

  // 进入家庭页面
  console.log('Navigating to /family...');
  await page.goto(`${baseUrl}/family`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, '04-family-page-links.png'), fullPage: true });

  await browser.close();
  console.log('Screenshots complete!');
}

run().catch(console.error);

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const artifactDir = '/home/ubuntu/.gemini/antigravity-cli/brain/21118ddf-2c95-4686-8cb6-172e87c0b6bc';
const baseUrl = 'http://127.0.0.1:3088';

async function main() {
  console.log('--- Registering test user via API ---');
  const testUsername = `test_cdp_${Date.now()}`;
  const password = 'TestPassword123!';

  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: testUsername,
      password: password,
      name: 'CDP Inspector',
      familyName: 'test_family_vis'
    })
  });

  const regData = await regRes.json();
  if (!regRes.ok) {
    throw new Error(`Register failed: ${JSON.stringify(regData)}`);
  }
  console.log(`Registered user: ${testUsername}`);

  const setCookie = regRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookie.match(/baby_auth_token=([^;]+)/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const authHeaders = {
    'Content-Type': 'application/json',
    'Cookie': `baby_auth_token=${token}`
  };

  // Create baby
  const babyRes = await fetch(`${baseUrl}/api/baby`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      nickname: '小西西',
      gender: 'female',
      birthDate: '2026-03-01'
    })
  });
  const babyData = await babyRes.json();
  const babyId = babyData.id;
  console.log(`Created baby ID: ${babyId}`);

  // Seed sample growth records
  const sampleGrowths = [
    { date: '2026-09-02', weightKg: 7.35, heightCm: 67.2, headCircumferenceCm: 42.1 },
    { date: '2026-08-01', weightKg: 6.80, heightCm: 64.5, headCircumferenceCm: 41.2 },
    { date: '2026-07-01', weightKg: 6.20, heightCm: 61.8, headCircumferenceCm: 40.0 },
    { date: '2026-06-01', weightKg: 5.50, heightCm: 58.5, headCircumferenceCm: 38.6 },
    { date: '2026-04-15', weightKg: 4.50, heightCm: 54.0, headCircumferenceCm: 36.5 },
  ];

  for (const g of sampleGrowths) {
    await fetch(`${baseUrl}/api/growth`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ ...g, babyId })
    });
  }

  // Seed sample medical checkup report
  const medRes = await fetch(`${baseUrl}/api/medical/reports`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      babyId,
      title: '6月龄儿童常规体检与体格发育评估',
      category: 'growth',
      date: '2026-09-02',
      hospital: '上海市儿童医学中心',
      doctorNotes: '体格生长符合WHO标准，各指标均处于正常偏上区间。辅食添加情况良好，建议继续规律补充维生素D与铁强化米粉。',
      growthData: { weightKg: 7.35, heightCm: 67.2, headCircumferenceCm: 42.1 },
      items: [
        { name: '体重', value: '7.35', unit: 'kg', refRange: '5.7-9.3', status: 'normal' },
        { name: '身长', value: '67.2', unit: 'cm', refRange: '61.2-70.3', status: 'normal' },
        { name: '头围', value: '42.1', unit: 'cm', refRange: '39.3-44.5', status: 'normal' },
        { name: '血红蛋白 (Hb)', value: '124', unit: 'g/L', refRange: '110-140', status: 'normal' },
        { name: '骨密度 (Z值)', value: '+0.5', unit: 'SD', refRange: '-1.0 ~ +1.0', status: 'normal' },
      ]
    })
  });
  console.log(`Created medical report status: ${medRes.status}`);

  console.log('--- Launching Playwright Mobile Browser (width: 390px, iPhone 14) ---');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  await context.addCookies([{
    name: 'baby_auth_token',
    value: token,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();

  // 1. Visual inspect: /growth
  console.log('Navigating to /growth...');
  await page.goto(`${baseUrl}/growth`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  const growthScreenPath = path.join(artifactDir, 'cdp_01_growth_mobile.png');
  await page.screenshot({ path: growthScreenPath, fullPage: false });
  console.log(`Saved screenshot: ${growthScreenPath}`);

  // Scroll down to check measurement list card
  await page.evaluate(() => window.scrollBy(0, 520));
  await page.waitForTimeout(1000);
  const growthListPath = path.join(artifactDir, 'cdp_02_growth_list_mobile.png');
  await page.screenshot({ path: growthListPath, fullPage: false });
  console.log(`Saved screenshot: ${growthListPath}`);

  // 2. Visual inspect: /health/medical
  console.log('Navigating to /health/medical...');
  await page.goto(`${baseUrl}/health/medical`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  const medicalScreenPath = path.join(artifactDir, 'cdp_03_medical_cards_mobile.png');
  await page.screenshot({ path: medicalScreenPath, fullPage: false });
  console.log(`Saved screenshot: ${medicalScreenPath}`);

  // Click on the medical report to inspect Modal
  console.log('Clicking on medical report to inspect detail modal...');
  await page.click('text=6月龄儿童常规体检');
  await page.waitForTimeout(1500);
  const modalScreenPath = path.join(artifactDir, 'cdp_04_medical_modal_mobile.png');
  await page.screenshot({ path: modalScreenPath, fullPage: false });
  console.log(`Saved screenshot: ${modalScreenPath}`);

  // Close modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 3. Visual inspect: /growth/add
  console.log('Navigating to /growth/add...');
  await page.goto(`${baseUrl}/growth/add`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);
  // Fill in measurements to trigger live WHO breakdown
  await page.fill('input[placeholder="例: 7.35"]', '7.45');
  await page.fill('input[placeholder="例: 67.2"]', '67.5');
  await page.fill('input[placeholder="例: 42.1"]', '42.3');
  await page.waitForTimeout(1000);
  // Scroll down to see WHO preview
  await page.evaluate(() => window.scrollBy(0, 350));
  await page.waitForTimeout(500);
  const growthAddPath = path.join(artifactDir, 'cdp_05_growth_add_live_who_mobile.png');
  await page.screenshot({ path: growthAddPath, fullPage: false });
  console.log(`Saved screenshot: ${growthAddPath}`);

  await browser.close();
  console.log('=== CDP Visual Acceptance Completed Successfully ===');
}

main().catch(err => {
  console.error('Visual acceptance failed:', err);
  process.exit(1);
});

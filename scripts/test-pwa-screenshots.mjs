import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = '/home/ubuntu/.gemini/antigravity-cli/brain/3e847335-490c-4897-9749-058d8c171efe/scratch/screenshots';
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

  // 1. Home page with PWA Banner
  console.log('Navigating to Home...');
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, '01-home-pwa-banner.png') });
  console.log('Saved 01-home-pwa-banner.png');

  // 2. Click PWA Banner to open Guide Modal
  console.log('Clicking PWA Banner...');
  const banner = await page.$('text=保存为桌面 App 体验更佳');
  if (banner) {
    await banner.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, '02-pwa-guide-modal.png') });
    console.log('Saved 02-pwa-guide-modal.png');
  }

  // 3. Family Page
  console.log('Navigating to Family page...');
  await page.goto(`${baseUrl}/family`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, '03-family-pwa-entry.png') });
  console.log('Saved 03-family-pwa-entry.png');

  await browser.close();
  console.log('PWA screenshots done!');
}

run();

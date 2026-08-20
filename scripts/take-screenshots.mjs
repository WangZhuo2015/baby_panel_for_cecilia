import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = '/home/ubuntu/.gemini/antigravity-cli/brain/3e847335-490c-4897-9749-058d8c171efe/scratch/screenshots';
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = 'http://127.0.0.1:3088';

const pages = [
  { name: '01-home.png', path: '/' },
  { name: '02-growth.png', path: '/growth' },
  { name: '03-growth-add.png', path: '/growth/add' },
  { name: '04-health-vaccines.png', path: '/health/vaccines' },
  { name: '05-health-medical.png', path: '/health/medical' },
  { name: '06-health-medical-add.png', path: '/health/medical/add' },
  { name: '07-food.png', path: '/food' },
  { name: '08-development.png', path: '/development' },
  { name: '09-family.png', path: '/family' },
  { name: '10-login.png', path: '/login' },
  { name: '11-register.png', path: '/register' },
];

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // Mobile viewport: 390x844 (iPhone 14/15)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  for (const p of pages) {
    console.log(`Navigating to ${p.path}...`);
    try {
      await page.goto(`${baseUrl}${p.path}`, { waitUntil: 'networkidle', timeout: 10000 });
      await page.waitForTimeout(1000);
      const outPath = path.join(outDir, p.name);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`Saved ${outPath}`);
    } catch (err) {
      console.error(`Failed on ${p.path}:`, err.message);
    }
  }

  await browser.close();
  console.log('All screenshots completed!');
}

run();

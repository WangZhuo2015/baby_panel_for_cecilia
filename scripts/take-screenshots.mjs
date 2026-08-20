import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const outDir = '/home/ubuntu/.gemini/antigravity-cli/brain/3e847335-490c-4897-9749-058d8c171efe/scratch/screenshots';
fs.mkdirSync(outDir, { recursive: true });

const baseUrl = 'http://127.0.0.1:3088';

const pages = [
  { name: '01-home.png', path: '/' },
  { name: '02-feeding-record.png', path: '/records/feeding' },
  { name: '03-sleep-record.png', path: '/records/sleep' },
  { name: '04-diaper-record.png', path: '/records/diaper' },
  { name: '05-growth.png', path: '/growth' },
  { name: '06-food.png', path: '/food' },
];

async function run() {
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

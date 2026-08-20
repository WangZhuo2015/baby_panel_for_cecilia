import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

function getHtml(size) {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${size}px; height:${size}px; overflow:hidden; background:transparent; display:flex; align-items:center; justify-content:center; }
  svg { width:100%; height:100%; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFF0F5"/>
      <stop offset="50%" stop-color="#FFE4EE"/>
      <stop offset="100%" stop-color="#FFD1E0"/>
    </linearGradient>
    <linearGradient id="primary" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF75A4"/>
      <stop offset="100%" stop-color="#FF4D85"/>
    </linearGradient>
    <linearGradient id="bow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF5C8D"/>
      <stop offset="100%" stop-color="#E83068"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#FF4D85" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Background rounded rect -->
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  
  <!-- Outer glowing circle -->
  <circle cx="256" cy="256" r="190" fill="#FFFFFF" filter="url(#shadow)"/>

  <!-- Baby Face Group -->
  <g transform="translate(256, 260) scale(1.15)">
    <!-- Ears -->
    <ellipse cx="-100" cy="-5" rx="18" ry="24" fill="#FFE8E8" stroke="#FF4D85" stroke-width="8"/>
    <ellipse cx="100" cy="-5" rx="18" ry="24" fill="#FFE8E8" stroke="#FF4D85" stroke-width="8"/>

    <!-- Head -->
    <ellipse cx="0" cy="0" rx="102" ry="105" fill="#FFEAEB" stroke="#FF4D85" stroke-width="9"/>
    
    <!-- Cheeks (Blush) -->
    <ellipse cx="-55" cy="20" rx="16" ry="11" fill="#FFAEC9" opacity="0.75"/>
    <ellipse cx="55" cy="20" rx="16" ry="11" fill="#FFAEC9" opacity="0.75"/>

    <!-- Eyes (Cute curved happy arcs) -->
    <path d="M -50 -5 Q -38 -20 -26 -5" fill="none" stroke="#4A252B" stroke-width="7" stroke-linecap="round"/>
    <path d="M 26 -5 Q 38 -20 50 -5" fill="none" stroke="#4A252B" stroke-width="7" stroke-linecap="round"/>

    <!-- Cute Smile -->
    <path d="M -22 25 Q 0 48 22 25" fill="none" stroke="#FF4D85" stroke-width="8" stroke-linecap="round"/>

    <!-- Cute Hair Tuft -->
    <path d="M 0 -105 Q 15 -130 30 -115 Q 15 -105 5 -95" fill="url(#primary)" stroke="url(#primary)" stroke-width="3"/>

    <!-- Cute Bow Ribbon on top right -->
    <g transform="translate(60, -90) rotate(15)">
      <polygon points="0,0 -22,-12 -22,12" fill="url(#bow)"/>
      <polygon points="0,0 22,-12 22,12" fill="url(#bow)"/>
      <circle cx="0" cy="0" r="7" fill="#FFD76A"/>
    </g>
  </g>
</svg>
</body>
</html>`;
}

async function generate() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const publicDir = path.join(process.cwd(), 'public');

  // 512x512
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(getHtml(512));
  await page.screenshot({ path: path.join(publicDir, 'icon-512.png'), omitBackground: false });

  // 192x192
  await page.setViewportSize({ width: 192, height: 192 });
  await page.setContent(getHtml(192));
  await page.screenshot({ path: path.join(publicDir, 'icon-192.png'), omitBackground: false });

  // 180x180
  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(getHtml(180));
  await page.screenshot({ path: path.join(publicDir, 'apple-touch-icon.png'), omitBackground: false });

  await browser.close();
  console.log('App icons perfectly regenerated!');
}

generate();

// Captures the /triage affordance gallery at 1440x900 and 810x1080.
// One-shot script for the [GSO-36](/GSO/issues/GSO-36) visual-truth gate.
//
// Usage:
//   1. npm install --no-save puppeteer-core   (no Chromium download)
//   2. NODE_ENV=production npm run build && NODE_ENV=production npm start -- --port 3030
//   3. node scripts/screenshot-affordance.mjs
//
// puppeteer-core is intentionally NOT in package.json — this is a tool you
// pull on demand when re-capturing affordance screenshots, not a runtime dep.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.GSO_TRIAGE_URL || 'http://127.0.0.1:3030/triage';
const OUT = path.resolve('docs/triage-screenshots');
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: 'triage-1440x900', width: 1440, height: 900 },
  { name: 'triage-810x1080', width: 810, height: 1080 }
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu']
});

try {
  for (const shot of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: shot.width, height: shot.height });
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    // small settle for any post-hydration paint
    await new Promise((r) => setTimeout(r, 500));
    const fullPath = path.join(OUT, `${shot.name}.png`);
    await page.screenshot({ path: fullPath, fullPage: true });
    console.log(`wrote ${fullPath}`);
    await page.close();
  }
} finally {
  await browser.close();
}

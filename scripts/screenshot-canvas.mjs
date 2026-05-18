// One-shot screenshot script for the Org Canvas drawer (GSO-55).
// Local tool — not a permanent devDep. Install before running:
//   npm install --no-save playwright
//   npx playwright install chromium
// Then start the dev server (npm run dev) and:
//   node scripts/screenshot-canvas.mjs [http://localhost:3000]
// Output lands in ./screenshots (gitignored).
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:3179';
const outDir = path.resolve('screenshots');
await fs.mkdir(outDir, { recursive: true });

const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'tablet-810x1080', width: 810, height: 1080 }
];

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();

    // 1. Closed drawer
    await page.goto(`${base}/canvas`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('[data-agent-id]', { timeout: 15_000 });
    await page.screenshot({
      path: path.join(outDir, `${vp.name}-01-closed.png`),
      fullPage: false
    });
    console.log(`Wrote ${vp.name}-01-closed.png`);

    // 2. Drawer open — click first agent card
    const firstCard = page.locator('[data-agent-id]').first();
    await firstCard.click();
    await page.waitForSelector('aside[role="dialog"][data-slot-kind="agent-detail"]', {
      timeout: 5_000
    });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(outDir, `${vp.name}-02-drawer-agent-detail.png`),
      fullPage: false
    });
    console.log(`Wrote ${vp.name}-02-drawer-agent-detail.png`);

    // 3. Keyboard nav: focus first card, arrow-down twice, Enter
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await firstCard.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
    await page.keyboard.press('Enter');
    await page.waitForSelector('aside[role="dialog"][data-slot-kind="agent-detail"]', {
      timeout: 5_000
    });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(outDir, `${vp.name}-03-keyboard-walkthrough.png`),
      fullPage: false
    });
    console.log(`Wrote ${vp.name}-03-keyboard-walkthrough.png`);

    // 4. Stub slot (routing-trace) — deep-link via ?slot=
    await page.goto(`${base}/canvas?slot=routing-trace:GSO-36`, {
      waitUntil: 'networkidle',
      timeout: 30_000
    });
    await page.waitForSelector('aside[role="dialog"][data-slot-kind="routing-trace"]', {
      timeout: 5_000
    });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(outDir, `${vp.name}-04-stub-routing-trace.png`),
      fullPage: false
    });
    console.log(`Wrote ${vp.name}-04-stub-routing-trace.png`);

    await context.close();
  }
} finally {
  await browser.close();
}

console.log('All screenshots written to', outDir);

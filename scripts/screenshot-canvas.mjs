// One-shot screenshot script for the Org Canvas (GSO-72 v0.1.1 verification).
// Local tool — not a permanent devDep. Install before running:
//   npm install --no-save playwright
//   npx playwright install chromium
// Then start the dev server (npm run dev) and:
//   node scripts/screenshot-canvas.mjs [http://localhost:3000]
// Output lands in ./screenshots (gitignored).
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const base = process.argv[2] ?? 'http://localhost:3000';
const outDir = path.resolve('screenshots');
await fs.mkdir(outDir, { recursive: true });

const viewports = [{ name: 'desktop-1440x900', width: 1440, height: 900 }];

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(`${base}/canvas`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('[data-testid^="agent-card-"]', { timeout: 15_000 });
    await page.waitForTimeout(250);
    const out = path.join(outDir, `${vp.name}-canvas-v0.1.1.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`Wrote ${out}`);
    await context.close();
  }
} finally {
  await browser.close();
}

// Makes the app's icons from docs/logo.svg (needs Playwright):  node tools/make_icons.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = readFileSync(new URL('../docs/logo.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-512', 512, 0], ['icon-192', 192, 0], ['apple-touch-icon', 180, 0], ['maskable-512', 512, 0.1]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // The "maskable" icon fills the square edge to edge, with the picture a little smaller inside (phones cut the corners).
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<body style="margin:0;background:${pad ? '#c2255c' : 'transparent'};display:grid;place-items:center;width:${size}px;height:${size}px"><div style="width:${inner}px;height:${inner}px">${svg}</div></body>`);
  await page.screenshot({ path: new URL(`../assets/icons/${name}.png`, import.meta.url).pathname, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons made');

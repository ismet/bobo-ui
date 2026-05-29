import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const errors = [];
const consoleErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);

const rootLen = await page.locator('#root').evaluate((el) => el.innerHTML.length);
if (rootLen < 1000) errors.push(`React root too small (len=${rootLen})`);

const plantsFetchOk = await page.evaluate(async () => {
  const r = await fetch('/api/power-plants');
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.plants ?? j.data ?? [];
  return { ok: true, count: list.length };
});
if (!plantsFetchOk.ok) errors.push(`fetch /api/power-plants failed: ${plantsFetchOk.status}`);

await page.locator('summary').filter({ hasText: /load price/i }).click();
await page.getByRole('button', { name: 'Paste' }).click();
await page.getByRole('button', { name: 'PV mode ON' }).click();

const lines = [];
for (let i = 0; i < 1422; i++) {
  lines.push(`${(40 + (i % 24) * 2).toFixed(2)}\t${Math.min(12, 5 + (i % 24) * 0.25).toFixed(3)}`);
}
await page.locator('textarea').first().fill(lines.join('\n'));
await page.getByRole('button', { name: 'Load data' }).click();
await page.waitForTimeout(800);

const trimVisible = await page.locator('text=/Horizon shortened/i').isVisible();
if (!trimVisible) errors.push('expected horizon trim notice for 1422h with PV on');

await page.getByRole('button', { name: /optimize dispatch/i }).click();

await page.waitForFunction(
  () => !document.querySelector('.job-overlay-root'),
  null,
  { timeout: 180000 },
).catch(() => errors.push('optimize overlay did not dismiss'));

await page.waitForTimeout(1500);

const kpiVisible = await page.locator('text=/Hybrid revenue/i').first().isVisible().catch(() => false);
if (!kpiVisible) errors.push('KPI row not visible after optimize');

const intervalMatch = await page.evaluate(() => {
  const m = document.body.innerText.match(/([\d,]+) intervals/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
});
if (intervalMatch !== 1416) errors.push(`expected 1416 intervals, got ${intervalMatch}`);

if (consoleErrors.some((t) => /wind is undefined|\.toFixed/.test(t) && t.includes('undefined'))) {
  errors.push(`console errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
}

await page.screenshot({ path: '/tmp/bobo-playwright.png', fullPage: true });
await browser.close();

const summary = {
  ok: errors.length === 0,
  rootLen,
  plantsFetchOk,
  trimVisible,
  kpiVisible,
  intervalMatch,
  errors,
  consoleErrors: consoleErrors.slice(0, 5),
};
console.log(JSON.stringify(summary, null, 2));
process.exit(errors.length === 0 ? 0 : 1);

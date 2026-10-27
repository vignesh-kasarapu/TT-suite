import { chromium } from '@playwright/test';
const BASE = 'http://localhost:8000', OUT = process.argv[2];
const browser = await chromium.launch();
const anon = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const p0 = await anon.newPage();
await p0.goto('/login'); await p0.waitForTimeout(1500);
await p0.screenshot({ path: `${OUT}/v-signin.png` });
const people = await (await anon.request.get('/api/auth/dev/users')).json();
const admin = people.find((p) => p.isGlobalAdmin);
const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
await ctx.request.post('/api/auth/dev/sign-in', { data: { email: admin.email }, headers: { 'X-Requested-With': 'XHR' } });
const page = await ctx.newPage();
for (const [name, url] of [['portal', '/'], ['kanban-board', '/kanban/'], ['kanban-reports', '/kanban/reports'], ['ems-home', '/expense/'], ['ems-claims', '/expense/claims'], ['lms', '/lms/'], ['ams', '/ams/']]) {
  await page.goto(url); await page.waitForTimeout(3000);
  if (name === 'kanban-reports') {
    const sel = page.getByTestId('report-month');
    if (await sel.count()) { await sel.selectOption('custom'); await page.waitForTimeout(500); }
  }
  await page.screenshot({ path: `${OUT}/v-${name}.png` });
  console.log('shot', name, new URL(page.url()).pathname);
}
await browser.close();

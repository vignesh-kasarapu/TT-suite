import { chromium } from '@playwright/test';
const BASE = 'http://localhost:8000', OUT = process.argv[2];
const X = { 'X-Requested-With': 'XHR' };
const browser = await chromium.launch();
async function signIn(email) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const r = await ctx.request.post('/api/auth/dev/sign-in', { data: { email }, headers: X });
  return { ctx, status: r.status() };
}
const probe = await browser.newContext({ baseURL: BASE });
const admin = (await (await probe.request.get('/api/auth/dev/users')).json()).find((p) => p.isGlobalAdmin);
const { ctx: A } = await signIn(admin.email);
const access = { lms: { role: 'employee' }, expense: { role: 'member' }, kanban: { role: 'member' }, ams: { role: 'employee' }, resume: { role: 'recruiter' } };
const post = (data) => A.request.post('/api/admin/users', { data, headers: X });
let r = await post({ email: 'qa.code@tektalis.com', name: 'QA Code', employeeCode: '', access });
console.log('invite without code:', r.status(), (await r.json()).code);
r = await post({ email: 'qa.code@tektalis.com', name: 'QA Code', employeeCode: 'QA-9001', access });
const inv = await r.json();
console.log('invite with QA-9001:', r.status(), '| app errors:', JSON.stringify(inv.errors));
const uid = inv.user.id;
r = await post({ email: 'qa.other@tektalis.com', name: 'QA Other', employeeCode: 'qa-9001', access: {} });
console.log('second invite with qa-9001:', r.status(), (await r.json()).code);

// The person: code in /api/me and in every top bar
const { ctx: Q, status } = await signIn('qa.code@tektalis.com');
console.log('person dev sign-in:', status, '| /api/me employeeCode:', (await (await Q.request.get('/api/me')).json()).employeeCode);
const page = await Q.newPage();
for (const [label, url] of [['portal', '/'], ['lms', '/lms/'], ['expense', '/expense/'], ['kanban', '/kanban/'], ['ams', '/ams/'], ['resume', '/resume/dashboard']]) {
  await page.goto(url);
  const code = await page.getByTestId('header-employee-code').first().textContent({ timeout: 30000 }).catch(() => 'NOT FOUND');
  console.log(`top bar ${label}:`, code?.trim());
  await page.screenshot({ path: `${OUT}/code-${label}.png` });
}

// Global admin edits details: code + email
r = await A.request.patch(`/api/admin/users/${uid}`, { data: { employeeCode: 'QA-9002', email: 'qa.code2@tektalis.com', jobTitle: 'Tester' }, headers: X });
const ed = await r.json();
console.log('edit details:', r.status(), '| email now', ed.user?.email, '| code', ed.user?.employeeCode, '| app errors:', JSON.stringify(ed.errors));
// the person (same session) visits every app again so each app syncs
for (const url of ['/lms/', '/expense/', '/kanban/', '/ams/', '/resume/dashboard']) {
  await page.goto(url);
  const code = await page.getByTestId('header-employee-code').first().textContent({ timeout: 30000 }).catch(() => 'NOT FOUND');
  console.log(`after edit ${url}:`, code?.trim());
}
console.log('UID', uid);

// Deactivate
r = await A.request.patch(`/api/admin/users/${uid}`, { data: { status: 'inactive' }, headers: X });
console.log('deactivate:', r.status(), '| app errors:', JSON.stringify((await r.json()).errors));
console.log('after deactivate /api/me:', (await Q.request.get('/api/me')).status());
for (const p of ['/lms/api/employees/me', '/expense/api/auth/me', '/kanban/api/v1/me', '/ams/api/v1/auth/me', '/resume/api/v1/auth/me']) {
  console.log(`after deactivate ${p}:`, (await Q.request.get(p)).status());
}
const again = await signIn('qa.code2@tektalis.com');
console.log('sign-in again after deactivate:', again.status);
await browser.close();

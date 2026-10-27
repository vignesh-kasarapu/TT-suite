import { expect, test } from '@playwright/test';
import { ADMIN, expectAppOpened, invite, signIn, uniqueEmail, XHR } from '../support/suite';

const PAGES = [
  { name: 'dashboard', path: '/' },
  { name: 'lms', path: '/lms/' },
  { name: 'expense', path: '/expense/' },
  { name: 'kanban', path: '/kanban/' },
  { name: 'ams', path: '/ams/' },
] as const;

test('every top bar has the light/dark toggle and the inbox beside the name, with the same unread count', async ({ page }) => {
  const email = uniqueEmail('topbar');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', expense: 'member', kanban: 'member', ams: 'employee' });

  await signIn(page, email); // the invitation is one unread message
  const unread = (await (await page.request.get('/api/me')).json()).unreadCount as number;
  expect(unread).toBeGreaterThan(0);

  for (const p of PAGES) {
    await page.goto(p.path);
    if (p.name !== 'dashboard') await expectAppOpened(page, p.name);
    const toggle = page.getByTestId('theme-toggle').first();
    const inbox = page.getByTestId('inbox-link').first();
    await expect(toggle, p.name).toBeVisible();
    await expect(inbox, p.name).toBeVisible();
    await expect(inbox, p.name).toHaveAttribute('aria-label', `Inbox, ${unread} unread`);
    // toggle, then inbox, both in the top 64px
    const [t, i] = [await toggle.boundingBox(), await inbox.boundingBox()];
    expect(t!.x, `${p.name}: toggle before inbox`).toBeLessThan(i!.x);
    expect(i!.y + i!.height, `${p.name}: in the top bar`).toBeLessThanOrEqual(64);
  }
});

test('the Tektalis logo in every app goes to the main dashboard', async ({ page }) => {
  const email = uniqueEmail('logo');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', expense: 'member', kanban: 'member', ams: 'employee' });
  await signIn(page, email);

  for (const p of PAGES.filter((x) => x.name !== 'dashboard')) {
    await page.goto(p.path);
    await expectAppOpened(page, p.name);
    await page.getByTestId('brand-home').first().click();
    await expect(page, p.name).toHaveURL(/:\d+\/$/);
    await expect(page.getByTestId('theme-toggle'), p.name).toBeVisible(); // the portal shell, not the app's home
  }
});

test('the light/dark toggle in one app switches every app', async ({ page }) => {
  const email = uniqueEmail('toggle');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', ams: 'employee' });
  await signIn(page, email);
  await page.request.put('/api/me/preferences', { data: { preset: 'linen', mode: 'light' }, headers: XHR });

  await page.goto('/ams/');
  await expectAppOpened(page, 'ams');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).preferences.mode).toBe('dark');

  for (const path of ['/', '/lms/']) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
  await page.getByTestId('theme-toggle').first().click(); // and back, from LMS
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => (await (await page.request.get('/api/me')).json()).preferences.mode).toBe('light');
});

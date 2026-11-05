import { expect, test } from '@playwright/test';
import { ADMIN, invite, signIn, uniqueEmail, XHR, SKIPPED } from '../support/suite';

test.skip(SKIPPED.has('ams'), 'Asset Management is not in this build (SUITE_SKIP)');

test('an app admin requests a role; the global admin approves it in the Inbox; the app applies it', async ({ page }) => {
  const appAdmin = uniqueEmail('ams-admin');
  const worker = uniqueEmail('ams-worker');
  await signIn(page, ADMIN);
  await invite(page, appAdmin, { ams: 'admin' });
  await invite(page, worker, { ams: 'employee' });

  // The worker opens AMS once, so AMS has their user.
  await signIn(page, worker);
  expect((await (await page.request.get('/ams/api/v1/auth/me')).json()).role).toBe('EMPLOYEE');

  // The AMS admin can no longer change roles in AMS; they ask the global admin instead.
  await signIn(page, appAdmin);
  const users = (await (await page.request.get('/ams/api/v1/users?size=100')).json()).items as { id: number; email: string }[];
  const target = users.find((u) => u.email === worker);
  expect(target).toBeTruthy();
  const asked = await page.request.post(`/ams/api/v1/users/${target!.id}/role-request`, {
    data: { role: 'manager', note: 'runs the store room' },
    headers: XHR,
  });
  expect(asked.status(), await asked.text()).toBeLessThan(300);
  expect((await (await page.request.get('/ams/api/v1/auth/me')).json()).role).toBe('ADMIN');

  // The global admin decides in the dashboard Inbox.
  await signIn(page, ADMIN);
  await page.goto('/');
  await expect(page.getByTestId('inbox-link')).toContainText(/\d/); // unread count
  await page.getByTestId('inbox-link').click();
  const request = page.getByTestId(`request-${worker}`);
  await expect(request).toContainText('Manager in Asset Management');
  await expect(request).toContainText('runs the store room');
  await request.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/is now Manager in Asset Management/)).toBeVisible();

  // Applied in AMS at once; the asker is told.
  await signIn(page, worker);
  expect((await (await page.request.get('/ams/api/v1/auth/me')).json()).role).toBe('ASSET_MANAGER');
  await signIn(page, appAdmin);
  const inbox = (await (await page.request.get('/api/me/inbox')).json()).items as { title: string }[];
  expect(inbox.some((m) => m.title.startsWith('Approved:'))).toBe(true);
});

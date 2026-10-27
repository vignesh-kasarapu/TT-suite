import { expect, test } from '@playwright/test';
import { ADMIN, expectAppOpened, invite, signIn, THEMED_APPS, uniqueEmail, XHR } from '../support/suite';

test('one theme choice is applied in every app', async ({ page }) => {
  const email = uniqueEmail('theme');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', expense: 'member', kanban: 'member', ams: 'employee' });

  await signIn(page, email);
  const saved = await page.request.put('/api/me/preferences', { data: { preset: 'harbour', mode: 'dark' }, headers: XHR });
  expect(saved.status(), await saved.text()).toBe(200);

  for (const app of THEMED_APPS) {
    await page.goto(`/${app}/`);
    await expectAppOpened(page, app);
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'harbour');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  }
});

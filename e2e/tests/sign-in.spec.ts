import { expect, test } from '@playwright/test';
import { expectAppOpened, XHR } from '../support/suite';

test('an anonymous visit to an app goes to the suite sign-in and comes back to that app', async ({ page }) => {
  await page.goto('/kanban/');
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get('returnTo') ?? '')).toContain('/kanban');

  await page.getByRole('button', { name: /E2E Admin/ }).click();
  await expectAppOpened(page, 'kanban');
});

test('someone who was never invited cannot sign in', async ({ page }) => {
  const res = await page.request.post('/api/auth/dev/sign-in', { data: { email: 'stranger@example.com' }, headers: XHR });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe('NOT_ADMITTED');
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

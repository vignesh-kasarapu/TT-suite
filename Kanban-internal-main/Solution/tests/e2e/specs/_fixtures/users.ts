// E2E sign-in through the real dev sign-in endpoint (cookie lands in the page context).
import { expect, type Page } from '@playwright/test';
import { fixtureId } from '../../../fixtures/seed-dev';

export { fixtureId };
const CSRF = { 'X-Requested-With': 'XHR' };

export async function signInViaApi(page: Page, code: string): Promise<void> {
  const res = await page.request.post('/api/v1/auth/dev/sign-in', {
    headers: CSRF,
    data: { userId: fixtureId(code) },
  });
  expect(res.status(), `dev sign-in ${code}`).toBe(204);
}

export async function resetPreferences(page: Page): Promise<void> {
  const res = await page.request.patch('/api/v1/me/preferences', {
    headers: CSRF,
    data: { theme: 'system', accent: 'linen', inboxWindowDays: 30 },
  });
  expect(res.status()).toBe(200);
}

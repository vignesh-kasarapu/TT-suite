import { expect, test, type Browser } from '@playwright/test';
import { ADMIN, invite, signIn, uniqueEmail } from '../support/suite';

/** A second "device": its own browser context with its own session cookie. */
async function device(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

test('one account on two devices; "this device" keeps the other one signed in', async ({ browser }) => {
  const admin = await device(browser, ADMIN);
  const email = uniqueEmail('two-devices');
  await invite(admin.page, email, { lms: 'employee' });

  const laptop = await device(browser, email);
  const phone = await device(browser, email);

  await laptop.page.goto('/signout');
  await expect(laptop.page.getByText('You are signed in on 2 devices.')).toBeVisible();
  await laptop.page.getByTestId('signout-this').click();
  await expect(laptop.page).toHaveURL(/\/login/);

  expect((await phone.page.request.get('/api/me')).status()).toBe(200);
  expect((await laptop.page.request.get('/api/me')).status()).toBe(401);
  await Promise.all([admin.context.close(), laptop.context.close(), phone.context.close()]);
});

test('"all devices" signs the account out everywhere, apps included', async ({ browser }) => {
  const admin = await device(browser, ADMIN);
  const email = uniqueEmail('all-devices');
  await invite(admin.page, email, { lms: 'employee', expense: 'member' });

  const laptop = await device(browser, email);
  const phone = await device(browser, email);

  await phone.page.goto('/signout');
  await phone.page.getByTestId('signout-all').click();
  await expect(phone.page).toHaveURL(/\/login/);

  for (const path of ['/api/me', '/lms/api/employees/me', '/expense/api/auth/me']) {
    expect((await laptop.page.request.get(path)).status(), path).toBe(401);
  }
  await Promise.all([admin.context.close(), laptop.context.close(), phone.context.close()]);
});

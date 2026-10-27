import { expect, test } from '@playwright/test';
import { ADMIN, expectAppOpened, invite, signIn, uniqueEmail, userRow } from '../support/suite';

test('removing access to one app denies it there and leaves the others working', async ({ page }) => {
  const email = uniqueEmail('revoke');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', kanban: 'member' });

  await page.goto('/admin');
  await userRow(page, email).getByRole('button', { name: 'Edit access' }).click();
  await page.getByTestId('role-lms').selectOption('');
  await page.getByTestId('access-save').click();
  await expect(page.getByText(`Access for ${email} was updated`)).toBeVisible();

  await signIn(page, email);
  await page.goto('/lms/');
  await expect(page).toHaveURL(/[?&]denied=lms/);
  await expect(page.getByText(/don't have access to/)).toBeVisible();
  await page.goto('/kanban/');
  await expectAppOpened(page, 'kanban');
});

test('deactivating a person signs them out of the portal and every app', async ({ page }) => {
  const email = uniqueEmail('deactivate');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee', expense: 'member', kanban: 'member', ams: 'employee' });

  await signIn(page, email);
  const theirSession = await page.context().cookies();
  expect((await page.request.get('/api/me')).status()).toBe(200);

  await signIn(page, ADMIN);
  await page.goto('/admin');
  page.once('dialog', (dialog) => void dialog.accept());
  await userRow(page, email).getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText(`${email} was deactivated`)).toBeVisible();

  await page.context().clearCookies();
  await page.context().addCookies(theirSession);
  for (const path of ['/api/me', '/kanban/api/v1/teams', '/lms/api/employees/me', '/expense/api/auth/me', '/ams/api/v1/auth/me']) {
    expect((await page.request.get(path)).status(), path).toBe(401);
  }
});

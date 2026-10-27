import { expect, test } from '@playwright/test';
import { ADMIN, expectAppOpened, invite, signIn, uniqueEmail, userRow } from '../support/suite';

test('the global admin gives an Asset Management role; the person gets it in AMS', async ({ page }) => {
  const email = uniqueEmail('ams');
  await signIn(page, ADMIN);
  await invite(page, email, { ams: 'manager' });

  // The person: one card they can open (AMS, as Manager), the rest locked.
  await signIn(page, email);
  await page.goto('/');
  await expect(page.getByTestId('card-ams')).toContainText('Manager');
  await page.getByTestId('card-ams').click();
  await expectAppOpened(page, 'ams');
  const me = await (await page.request.get('/ams/api/v1/auth/me')).json();
  expect(me.role).toBe('ASSET_MANAGER');
  expect(me.email).toBe(email);
});

test('removing Asset Management access in the portal sends the person back to the dashboard', async ({ page }) => {
  const email = uniqueEmail('ams-revoke');
  await signIn(page, ADMIN);
  await invite(page, email, { ams: 'employee', kanban: 'member' });

  await page.goto('/admin');
  await userRow(page, email).getByRole('button', { name: 'Edit access' }).click();
  await page.getByTestId('role-ams').selectOption('');
  await page.getByTestId('access-save').click();
  await expect(page.getByText(`Access for ${email} was updated`)).toBeVisible();

  await signIn(page, email);
  await page.goto('/ams/');
  await expect(page).toHaveURL(/[?&]denied=ams/);
  await expect(page.getByText(/don't have access to/)).toBeVisible();
});

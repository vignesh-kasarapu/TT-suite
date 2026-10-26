import { expect, test } from '@playwright/test';
import { ADMIN, expectAppOpened, mailTo, signIn, uniqueEmail, userRow } from '../support/suite';

test('invite from the UI: a role in each app, one invitation email, and an audit entry', async ({ page }) => {
  const email = uniqueEmail('invite');
  await signIn(page, ADMIN);
  await page.goto('/admin');

  await page.getByTestId('invite-open').click();
  await page.getByTestId('invite-email').fill(email);
  await page.getByTestId('role-lms').selectOption('admin');
  await page.getByTestId('role-expense').selectOption('member');
  await page.getByTestId('role-kanban').selectOption('member');
  await page.getByTestId('access-save').click();

  await expect(page.getByText(`${email} was invited`)).toBeVisible();
  const row = userRow(page, email);
  await expect(row).toContainText('Invited');
  await expect(row).toContainText('Admin');
  expect((await mailTo(page, email)).map((m) => m.kind)).toEqual(['suite_invited']);

  // The audit log names the person; with no name given, the apps use the email's first part.
  await page.goto('/admin/audit');
  const person = email.split('@')[0] ?? email;
  await expect(page.getByRole('row').filter({ hasText: person }).filter({ hasText: 'Invited' }).first()).toBeVisible();

  // The invited person sees their roles and opens an app.
  await signIn(page, email);
  await page.goto('/');
  await expect(page.getByTestId('card-lms')).toContainText('Admin');
  await expect(page.getByTestId('card-expense')).toContainText('Member');
  await expect(page.getByTestId('card-kanban')).toContainText('Member');
  await page.getByTestId('card-expense').click();
  await expectAppOpened(page, 'expense');
});

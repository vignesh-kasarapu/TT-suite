import { expect, test } from '@playwright/test';
import { ADMIN, employeeCode, mailTo, signIn, uniqueEmail } from '../support/suite';

test('CSV import: problem rows are flagged, the rest are invited once each with their roles', async ({ page }) => {
  const a = uniqueEmail('csv-a');
  const b = uniqueEmail('csv-b');
  const csv = [
    'email,name,employee_code,lms,ems,kanban,kanban_team,global_admin',
    `${a},CSV A,${employeeCode(a)},employee,member,member,,no`,
    `${b},"B, CSV",${employeeCode(b)},manager,approver,,,no`,
    'not-an-email,,,employee,,,,',
    `${a},Twice,${employeeCode(a)}X,admin,,,,`,
  ].join('\r\n');

  await signIn(page, ADMIN);
  await page.goto('/admin');
  await page.getByTestId('import-open').click();
  await page.getByTestId('import-file').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Ready');
  await expect(rows.nth(2)).toContainText('Not a valid email');
  await expect(rows.nth(3)).toContainText('Listed twice in the file');
  await expect(page.getByTestId('import-send')).toHaveText(/Send 2 invitations/);

  await page.getByTestId('import-send').click();
  await expect(page.getByText(/2 people were invited/)).toBeVisible();
  await expect(rows.nth(0)).toContainText('Invited');
  await expect(rows.nth(1)).toContainText('Invited');

  const users = (await (await page.request.get(`/api/admin/users?q=${encodeURIComponent('e2e.csv-b')}`)).json()).items;
  const bUser = users.find((u: { email: string }) => u.email === b);
  expect(bUser.name).toBe('B, CSV');
  expect(bUser.access).toEqual({ kanban: null, lms: 'manager', expense: 'approver', ams: null, resume: null });
  for (const email of [a, b]) {
    expect((await mailTo(page, email)).map((m) => m.kind)).toEqual(['suite_invited']);
  }
});

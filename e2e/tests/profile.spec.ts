import { expect, test } from '@playwright/test';
import { ADMIN, invite, signIn, uniqueEmail } from '../support/suite';

test('a person edits their basic details on Profile', async ({ page }) => {
  const email = uniqueEmail('profile');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee' });
  await signIn(page, email);

  await page.goto('/profile');
  await page.getByTestId('profile-name').fill('Asha Rao');
  await page.getByTestId('profile-job-title').fill('QA engineer');
  await page.getByTestId('profile-phone').fill('+91 98765 43210');
  await page.getByTestId('profile-location').fill('Hyderabad');
  await page.getByTestId('profile-save').click();
  await expect(page.getByRole('status')).toContainText('Saved');

  const me = await (await page.request.get('/api/me')).json();
  expect(me).toMatchObject({ name: 'Asha Rao', jobTitle: 'QA engineer', phone: '+91 98765 43210', location: 'Hyderabad' });

  await page.getByTestId('profile-phone').fill('call me');
  await page.getByTestId('profile-save').click();
  await expect(page.getByText(/Enter a phone number/)).toBeVisible();
});

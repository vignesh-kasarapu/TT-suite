import { expect, test } from '@playwright/test';
import { ADMIN, APPS, expectAppOpened, signIn } from '../support/suite';

test('the global admin sees every app card, each as Admin', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/');
  for (const app of APPS) {
    await expect(page.getByTestId(`card-${app}`)).toContainText('Admin');
  }
});

for (const app of APPS) {
  test(`the ${app} card checks the role and opens the app`, async ({ page }) => {
    await signIn(page, ADMIN);
    await page.goto('/');
    await page.getByTestId(`card-${app}`).click();
    await expectAppOpened(page, app);
  });
}

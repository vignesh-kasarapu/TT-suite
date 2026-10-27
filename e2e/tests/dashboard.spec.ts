import { expect, test } from '@playwright/test';
import { ADMIN, APPS, expectAppOpened, invite, signIn, uniqueEmail } from '../support/suite';

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

test('a person sees cards (and switcher entries) only for the apps they can open', async ({ page }) => {
  const email = uniqueEmail('one-app');
  await signIn(page, ADMIN);
  await invite(page, email, { lms: 'employee' });
  await signIn(page, email);
  await page.goto('/');
  await expect(page.getByTestId('card-lms')).toBeVisible();
  for (const app of APPS.filter((x) => x !== 'lms')) {
    await expect(page.getByTestId(`card-${app}`), app).toHaveCount(0);
  }
  await expect(page.getByTestId('card-resume')).toHaveCount(0);
  await page.getByTestId('app-switcher-open').click();
  await expect(page.getByTestId('app-lms')).toBeVisible();
  for (const app of ['expense', 'kanban', 'ams', 'resume']) {
    await expect(page.getByTestId(`app-${app}`), app).toHaveCount(0);
  }
});

test('a person with no app access sees no cards, only a note', async ({ page }) => {
  const email = uniqueEmail('no-app');
  await signIn(page, ADMIN);
  await invite(page, email, {});
  await signIn(page, email);
  await page.goto('/');
  await expect(page.getByTestId('no-apps')).toBeVisible();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(0);
});

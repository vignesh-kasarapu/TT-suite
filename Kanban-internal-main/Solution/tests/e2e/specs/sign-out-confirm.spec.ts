// D-159 at desktop / tablet / mobile: signing out asks first. Cancel keeps the session; confirming
// ends it. On a phone the More sheet's "Sign out" asks too.
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

test.describe('D-159 sign-out confirmation', () => {
  test('cancel stays signed in; confirm signs out', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M1');
    await page.goto('/teams');
    const confirm = page.getByTestId('sign-out-confirm');

    await page.getByTestId('who').getByTestId('sign-out').click();
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Sign out of Kanban?');
    await shot('sign-out-confirm');
    await axe('sign-out-confirm');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(page).toHaveURL(/\/teams$/);
    expect((await page.request.get('/api/v1/me')).status()).toBe(200);

    if ((page.viewportSize()?.width ?? 0) < 640) {
      // The More sheet's Sign out asks the same question.
      await page.getByTestId('nav').getByRole('button', { name: 'More' }).click();
      await page.getByTestId('more-sheet').getByTestId('sign-out').click();
      await expect(page.getByTestId('more-sheet').getByTestId('sign-out-confirm')).toBeVisible();
      await page
        .getByTestId('more-sheet')
        .getByTestId('sign-out-confirm')
        .getByRole('button', { name: 'Sign out' })
        .click();
    } else {
      await page.getByTestId('who').getByTestId('sign-out').click();
      await confirm.getByRole('button', { name: 'Sign out' }).click();
    }
    await expect(page).toHaveURL(/\/signed-out$/);
    expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  });
});

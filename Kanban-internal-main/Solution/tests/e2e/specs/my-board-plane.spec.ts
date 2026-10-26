// D-149 at desktop / tablet / mobile: My board reopens on the plane pressed last - Org stays Org
// across pages and reloads until Private is pressed, and the other way round.
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

test.describe('D-149 My board remembers the plane', () => {
  test('Org stays until Private is pressed', async ({ page, shot }) => {
    await signInViaApi(page, 'M1');
    // Nothing picked yet: Private, as before.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId('plane-switch').getByRole('link', { name: 'Org (my teams)' }).click();
    await expect(page).toHaveURL(/\/org$/);
    await page.goto('/teams');
    await page.goto('/');
    await expect(page).toHaveURL(/\/org$/);
    await expect(
      page.getByTestId('plane-switch').getByRole('link', { name: 'Org (my teams)' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.reload();
    await expect(page).toHaveURL(/\/org$/);
    await shot('my-board-remembers-org');

    await page.getByTestId('plane-switch').getByRole('link', { name: 'Private' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/teams');
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByTestId('plane-switch').getByRole('link', { name: 'Private' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

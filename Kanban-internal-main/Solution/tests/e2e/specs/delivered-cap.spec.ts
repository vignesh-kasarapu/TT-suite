// D-136 at three viewports: on a board the Delivered column shows no more cards than the fullest
// working column; "Show closed" shows them all. A fresh team keeps the counts
// exact while other specs share the database.
import { expect, test, type Page } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };

async function post<T>(page: Page, path: string, data: Record<string, unknown>): Promise<T> {
  const res = await page.request.post(`/api/v1/${path}`, { headers: CSRF, data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as T;
}

test.describe('D-136 delivered cap', () => {
  test('Delivered shows as many cards as the fullest working column; Show closed shows all', async ({
    page,
    shot,
  }) => {
    const width = page.viewportSize()?.width ?? 0;
    const stamp = `${width}-${Date.now()}`;
    // The admin works alone in a fresh team: no fixture person gains a team (other specs rely on
    // M1/M2 having exactly one, the default for their new org cards - CR-22).
    await signInViaApi(page, 'ADMIN');
    const team = await post<{ id: string }>(page, 'teams', { name: `Zcap ${stamp}` });
    const card = (title: string, state: string) =>
      post<{ key: string }>(page, 'cards', { title, plane: 'org', teamId: team.id, state });
    await card(`Working A ${stamp}`, 'ready');
    await card(`Working B ${stamp}`, 'ready');
    for (const n of [1, 2, 3, 4, 5]) await card(`Done ${n} ${stamp}`, 'delivered');

    await page.goto(`/teams/${team.id}`);
    if (width < 640) await page.getByTestId('column-switcher').selectOption('delivered');
    const delivered = page.getByTestId('column-delivered');
    // Ready holds 2, so 2 of the 5 delivered show; the count still says 5.
    await expect(delivered.locator('[data-testid^="card-K-"]')).toHaveCount(2);
    await expect(delivered.getByRole('heading')).toContainText('5');
    await expect(page.getByTestId('delivered-more')).toContainText('3 more delivered');
    await shot('delivered-capped');
    // "Show closed" shows every delivered card; unticked, the cap is back.
    await page.getByTestId('filters-open').click();
    await page.getByTestId('filter-closed').check();
    await expect(delivered.locator('[data-testid^="card-K-"]')).toHaveCount(5);
    await expect(page.getByTestId('delivered-more')).toHaveCount(0);
    await page.getByTestId('filter-closed').uncheck();
    await expect(delivered.locator('[data-testid^="card-K-"]')).toHaveCount(2);
  });
});

// D-152 at desktop / tablet / mobile: the Backlog tab is a table (cards on a phone) - sorted by
// priority, overdue due dates marked (the server's flag), rows selected and changed together
// through the normal API, and pages.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; overdue: boolean };
}

test.describe('D-152 backlog table', () => {
  test('sorted, overdue marked, bulk priority and bulk move', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const tag = `bl${width}x${Date.now()}`;
    const base = { plane: 'org', teamId: PLATFORM, state: 'backlog' };
    const low = await apiCreate(page, { ...base, title: `${tag} low`, priority: 3 });
    const high = await apiCreate(page, { ...base, title: `${tag} high`, priority: 1 });
    const late = await apiCreate(page, {
      ...base,
      title: `${tag} late`,
      priority: 2,
      eta: '2020-01-01',
    });
    expect(late.overdue).toBe(true); // the server decides

    await page.goto('/org/backlog');
    await page.getByTestId('filter-q').fill(tag);
    const table = page.getByTestId('column-backlog');
    await expect(page.getByTestId('backlog-count')).toHaveText('3 tasks');
    // Priority high to low: P1, P2, P3.
    const order = await table
      .locator('[data-testid^="card-K-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([`card-${high.key}`, `card-${late.key}`, `card-${low.key}`]);
    await expect(page.getByTestId(`card-${late.key}`)).toContainText('01 Jan 2020');
    await expect(page.getByTestId(`card-${late.key}`)).toContainText('(overdue)');
    await shot('backlog-table');
    await axe('backlog-table');

    // Sort by title instead.
    await page.getByTestId('backlog-sort').selectOption('title');
    await expect(table.locator('[data-testid^="card-K-"]').first()).toHaveAttribute(
      'data-testid',
      `card-${high.key}`,
    );

    // Select two and give them P4 together.
    await page.getByTestId(`pick-${low.key}`).check();
    await page.getByTestId(`pick-${late.key}`).check();
    await expect(page.getByTestId('bulk')).toContainText('2 selected');
    await page.getByTestId('bulk-priority').selectOption('4');
    await page.getByTestId('bulk-priority-apply').click();
    await expect(page.getByTestId('bulk-result')).toContainText('2 changed, 0 not changed');
    await expect(page.getByTestId(`card-${low.key}`).getByTitle(/^Priority 4/)).toBeVisible();
    await shot('backlog-bulk-done');

    // Select every card on the page (wide screens) and move them to In Prep: they leave.
    if (width >= 640) await page.getByTestId('pick-page').check();
    else for (const k of [high.key, late.key, low.key]) await page.getByTestId(`pick-${k}`).check();
    await page.getByTestId('bulk-state').selectOption('in_prep');
    await page.getByTestId('bulk-move').click();
    await expect(page.getByTestId('bulk-result')).toContainText('3 changed');
    await expect(page.getByTestId('backlog-count')).toHaveText('0 tasks');
  });

  test('pages: rows per page and the page buttons', async ({ page }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const tag = `pg${width}x${Date.now()}`;
    for (let i = 0; i < 12; i++)
      await apiCreate(page, {
        title: `${tag} ${String(i).padStart(2, '0')}`,
        plane: 'org',
        teamId: PLATFORM,
        state: 'backlog',
      });
    await page.goto('/org/backlog');
    await page.getByTestId('filter-q').fill(tag);
    await expect(page.getByTestId('backlog-showing')).toHaveText('Showing 1–10 of 12 tasks');
    await page.getByTestId('page-2').click();
    await expect(page.getByTestId('backlog-showing')).toHaveText('Showing 11–12 of 12 tasks');
    await expect(page.getByTestId('page-next')).toBeDisabled();
    await page.getByTestId('backlog-size').selectOption('25');
    await expect(page.getByTestId('backlog-showing')).toHaveText('Showing 1–12 of 12 tasks');
  });
});

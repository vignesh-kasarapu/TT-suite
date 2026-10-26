// S3b at three viewports: Time tab with total (D-071), Reports page (D-072), email opt-in and
// Teams webhook field (D-074/075).
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';
import { makeTeamless } from './_fixtures/legacy';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number; id: string };
}

test.describe('S3b', () => {
  test('time: log hours on a card; total and card.loggedHours update; edit and delete own', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const card = await apiCreate(page, {
      title: `Timed ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      effortHours: 4,
    });
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-time').click();
    await page.getByTestId('time-add-hours').fill('1.5');
    await page.getByTestId('time-add-note').fill('spike');
    await page.getByTestId('time-add-submit').click();
    await expect(page.getByTestId('time-entry')).toHaveCount(1);
    // CR-13: 'Logged' for a lead, 'You logged' for an ordinary member - both carry the total.
    await expect(page.getByTestId('time-total')).toContainText(/logged 1[.]5 h/i);
    await shot('time');
    await axe('time');
    await page.getByTestId('time-edit-btn').click();
    await page.getByTestId('time-edit-hours').fill('2');
    await page.getByTestId('time-edit-submit').click();
    await expect(page.getByTestId('time-total')).toContainText(/logged 2 h/i);
    await page.getByTestId('time-delete').click();
    await expect(page.getByTestId('time-entry')).toHaveCount(0);
  });

  test('reports: progress table by project and overdue list render; group-by switches', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    await apiCreate(page, {
      title: `Overdue ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      eta: '2020-01-01',
      assigneeId: fixtureId('M1'),
    });
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await expect(page.getByTestId('progress-table')).toBeVisible();
    await page.getByTestId('progress-groupby').selectOption('person');
    await expect(page.getByTestId('progress-row').first()).toBeVisible();
    await expect(page.getByTestId('overdue-group').first()).toBeVisible();
    await page.getByTestId('overdue-groupby').selectOption('assignee');
    await expect(
      page.getByTestId('overdue-group').filter({ hasText: 'Meera' }).first(),
    ).toBeVisible();
    await shot('reports');
    await axe('reports');

    // D-148: the graphs draw the same rows - summary tiles, cards by state with a legend naming
    // every state (UAT included), effort against logged hours, overdue per group.
    const summary = page.getByTestId('report-summary');
    await expect(summary).toBeVisible();
    expect(
      Number(await page.getByTestId('tile-overdue').locator('dd').textContent()),
    ).toBeGreaterThan(0);
    const states = page.getByTestId('chart-states');
    for (const name of ['Backlog', 'In Prep', 'Ready', 'In-Progress', 'UAT', 'Delivered'])
      await expect(
        states.getByRole('listitem').filter({ hasText: new RegExp(`^${name}$`) }),
      ).toHaveCount(1);
    await expect(page.getByTestId('chart-states-row').first()).toBeVisible();
    await expect(page.getByTestId('chart-states-row').first()).toHaveAccessibleName(/UAT \d+/);
    await expect(page.getByTestId('chart-effort')).toBeVisible();
    await expect(
      page.getByTestId('chart-overdue-row').filter({ hasText: 'Meera' }).first(),
    ).toBeVisible();
    // Each graph fits its viewport: no bar runs off the page.
    const width = page.viewportSize()?.width ?? 0;
    const box = await page.getByTestId('chart-states').boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await shot('reports-charts');
    await axe('reports-charts');
  });

  test('notifications: email opt-in toggle persists; admin sets and clears a Teams webhook', async ({
    page,
    browser,
  }) => {
    await signInViaApi(page, 'M2');
    await page.goto('/preferences');
    // click() rather than check(): the input is controlled, so its state flips on React's
    // re-render, a tick after the click.
    await expect(page.getByTestId('notify-email')).not.toBeChecked();
    await page.getByTestId('notify-email').click();
    await expect(page.getByTestId('notify-email')).toBeChecked();
    await page.reload();
    await expect(page.getByTestId('notify-email')).toBeChecked();
    await page.getByTestId('notify-email').click();
    await expect(page.getByTestId('notify-email')).not.toBeChecked();
    await page.reload();
    await expect(page.getByTestId('notify-email')).not.toBeChecked();

    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p2 = await other.newPage();
    await signInViaApi(p2, 'ADMIN');
    await p2.goto(`/admin/teams/${PLATFORM}`);
    await p2.getByTestId('teams-webhook').fill('https://example.test/webhook/abc');
    await p2.getByTestId('teams-webhook-save').click();
    await expect(p2.getByText('Status: set.')).toBeVisible();
    await p2.getByTestId('teams-webhook-clear').click();
    await expect(p2.getByText('Status: not set.')).toBeVisible();
    await other.close();
  });

  test('defaults (D-077): default team set on Preferences; the Org tab shows its cards first with a divider; project pills are coloured', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const stamp = Date.now();
    const mine = await apiCreate(page, {
      title: `Mine ${stamp}`,
      plane: 'org',
      teamId: PLATFORM,
      assigneeId: fixtureId('M1'),
      state: 'in_prep',
    });
    const loose = await apiCreate(page, {
      title: `Loose ${stamp}`,
      plane: 'org',
      assigneeId: fixtureId('M1'),
      state: 'in_prep',
    });
    // CR-22 would default it into Platform; the band test needs a card outside the default team.
    await makeTeamless(loose.key);
    await page.goto('/preferences');
    await page.getByTestId('default-team').selectOption(PLATFORM);
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.goto('/org');
    const col = page.getByTestId('column-in_prep');
    await expect(col.getByTestId('band-divider')).toBeVisible();
    const keys = await col
      .locator('[data-testid^="card-K-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(keys.indexOf(`card-${mine.key}`)).toBeLessThan(keys.indexOf(`card-${loose.key}`));
    await shot('org-defaults');
    // D-078: the new-card dialog starts from the default team when no filter is set.
    await page.getByTestId('column-add-in_prep').click();
    await expect(page.getByTestId('new-card-team')).toHaveValue(PLATFORM);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('new-card-dialog')).toHaveCount(0);
    await page.goto('/preferences');
    await page.getByTestId('default-team').selectOption('');
    await expect(page.getByText('Saved.')).toBeVisible();
  });
});

// D-156 at desktop / tablet / mobile: Team time as the user's mockup - KPI tiles, the members
// table (search, group by status, the "..." menu that shows a member's work), the two charts, the
// work table with its card state (the server's), filters, and the Export menu. Works on
// whatever week the app is in.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');
const M1 = fixtureId('M1');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; state: string };
}

test.describe('D-156 team time look', () => {
  test('tiles, members, charts, work table, export', async ({ page, shot, axe }) => {
    // Meera logs on a Platform card on the Monday of the app's current week.
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const title = `Team look ${width} ${Date.now()}`;
    const card = await apiCreate(page, { title, plane: 'org', teamId: PLATFORM, state: 'ready' });
    const week = (await (await page.request.get('/api/v1/me/time')).json()) as { start: string };
    const logged = await page.request.post(`/api/v1/cards/${card.key}/time`, {
      headers: CSRF,
      data: { date: week.start, hours: 2, note: 'team look' },
    });
    expect(logged.status(), await logged.text()).toBe(201);

    await signInViaApi(page, 'ADMIN');
    await page.goto(`/team-time?team=${PLATFORM}`);
    for (const id of ['kpi-hours', 'kpi-on-target', 'kpi-short', 'kpi-days-off'])
      await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('team-hours-chart')).toBeVisible();
    await expect(page.getByTestId('team-contribution')).toContainText('Meera Member');

    // Members: search narrows; group by status splits short from on target.
    await page.getByTestId('member-search').fill('Meera');
    await expect(page.getByTestId(`member-${M1}`)).toBeVisible();
    await page.getByTestId('member-search').fill('');
    await page.getByTestId('member-group').selectOption('status');
    await expect(page.getByTestId('member-group-short')).toBeVisible();
    await page.getByTestId('member-group').selectOption('none');

    // The "..." menu shows Meera's work; the entry carries the card's state from the server.
    await page.getByTestId(`member-menu-${M1}`).locator('summary').click();
    await page.getByTestId(`show-work-${M1}`).click();
    await expect(page.getByTestId('work-member')).toHaveValue(M1);
    await page.getByTestId('work-search').fill(card.key);
    const work = page.getByTestId('team-work');
    await expect(work.getByTestId('team-entry')).toHaveCount(1);
    await expect(work).toContainText('Ready');
    await expect(work).toContainText('team look');
    await page.getByTestId('work-state').selectOption('backlog');
    await expect(work.getByTestId('team-entry')).toHaveCount(0);
    await page.getByTestId('work-state').selectOption('');
    await shot('team-time-look');
    await axe('team-time-look');

    // Export: the members table and the work log as shown.
    await page.getByTestId('team-export-open').click();
    const [members] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-members').click(),
    ]);
    expect(members.suggestedFilename()).toMatch(/^team-members-Platform-\d{4}-\d{2}-\d{2}\.csv$/);
    const [log] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('work-export').click(),
    ]);
    const csv = Buffer.concat(
      (await (await log.createReadStream()).toArray()) as Buffer[],
    ).toString('utf8');
    expect(csv).toContain(`"${card.key}"`);
    expect(csv).toContain('"Ready"');
  });
});

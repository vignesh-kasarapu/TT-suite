// D-153 at desktop / tablet / mobile: the Reports page of the user's mockup - the month (the
// server's current one first; the server narrows cards and hours to it), the Export menu (effort
// CSV dialog, summary and overdue CSVs), and the summary table's search and sort.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string };
}

test.describe('D-153 reports look', () => {
  test('month, export menu, summary search and sort', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const name = `Rpt ${width} ${Date.now()}`;
    const admin = await page.context().browser()!.newContext();
    const adminPage = await admin.newPage();
    await signInViaApi(adminPage, 'ADMIN');
    const project = await adminPage.request.post('/api/v1/projects', {
      headers: CSRF,
      data: { name, teamId: PLATFORM },
    });
    expect(project.status(), await project.text()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    await admin.close();
    await apiCreate(page, {
      title: `${name} late`,
      plane: 'org',
      teamId: PLATFORM,
      projectId,
      eta: '2020-01-01',
    });

    await page.goto('/reports');
    // The month the server is in comes first; the lead says what the numbers cover.
    const month = page.getByTestId('report-month');
    await expect(month).not.toHaveValue('');
    const today = (await page.request
      .get('/api/v1/reports/overdue?groupBy=team')
      .then((r) => r.json())) as { today: string };
    await expect(month).toHaveValue(today.today.slice(0, 7));
    await expect(page.getByText(/created or closed in/)).toBeVisible();
    await expect(page.getByTestId('tile-open')).toBeVisible();
    await expect(page.getByTestId('cancelled-chip')).toContainText('Cancelled');
    await shot('reports-look');
    await axe('reports-look');

    // The summary table: search by name, sort a column.
    await page.getByTestId('summary-search').fill(name);
    await expect(page.getByTestId('progress-row')).toHaveCount(1);
    await expect(page.getByTestId('progress-row')).toContainText(name);
    await page.getByTestId('summary-search').fill('');
    await page.getByTestId('sort-open').click();
    await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Open');
    await page.getByTestId('sort-open').click();
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('Open');

    // An old month with nothing in it: the server sends no rows.
    const oldest = await month.locator('option').nth(-2).getAttribute('value');
    await month.selectOption(oldest!);
    await expect(page.getByTestId('progress-row')).toHaveCount(0);
    await month.selectOption('all');
    await expect(page.getByText(/created or closed in/)).toHaveCount(0);

    // Export: the summary and the overdue list as CSV; Effort opens its dialog.
    await page.getByTestId('export-open').click();
    const [summary] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-summary').click(),
    ]);
    expect(summary.suggestedFilename()).toBe('kanban-summary-project-all.csv');
    await page.getByTestId('export-open').click();
    const [overdue] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-overdue').click(),
    ]);
    expect(overdue.suggestedFilename()).toMatch(/^kanban-overdue-team-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (await overdue.createReadStream()).toArray();
    const csv = Buffer.concat(text as Buffer[]).toString('utf8');
    expect(csv).toContain(`"${name} late"`);
    await page.getByTestId('export-open').click();
    await page.getByTestId('export-effort').click();
    await expect(page.getByTestId('effort-csv-dialog')).toBeVisible();
  });
});

// CR-13 + CR-21 at desktop / tablet / mobile: a member's Time tab says it shows only their own
// hours, Reports offers the effort CSV (scoped by the server), and the Time tab refuses a 25th
// hour on one date with a message naming what is already logged.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const WEB = fixtureId('TEAM_WEB');
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string };
}

/** A date no other run uses: the Compose database keeps every earlier run's entries. */
function freshDate(): string {
  const d = new Date(Date.UTC(1990, 0, 1) + Math.floor(Math.random() * 10_000) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('CR-13 + CR-21', () => {
  test('CR-21: a 25th hour on one date is refused; CR-13: a member sees only their own hours', async ({
    page,
    shot,
    axe,
  }) => {
    // M2 is an ordinary member of Web in the fixture; no spec makes them a lead.
    await signInViaApi(page, 'M2');
    const date = freshDate();
    const card = await apiCreate(page, {
      title: `CR21 full day ${Date.now()}`,
      plane: 'org',
      teamId: WEB,
    });
    const res = await page.request.post(`/api/v1/cards/${card.key}/time`, {
      headers: CSRF,
      data: { date, hours: 24 },
    });
    expect(res.status(), await res.text()).toBe(201);
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-time').click();
    await expect(page.getByTestId('time-total')).toContainText('only your own hours');
    await page.getByTestId('time-add-date').fill(date);
    await page.getByTestId('time-add-hours').fill('1');
    await page.getByTestId('time-add-submit').click();
    await expect(page.getByRole('alert')).toContainText('24 h logged');
    await expect(page.getByTestId('time-entry')).toHaveCount(1);
    await shot('time-day-cap');
    await axe('time-day-cap');
  });

  test('CR-13 / D-097: the effort CSV asks for a period - last X days fills it, dates editable and required', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M2');
    await page.goto('/reports');
    // D-097 d: only my teams are offered (M2 is in Web, not Platform).
    const teamSelect = page.getByTestId('progress-team');
    await expect(teamSelect.locator(`option[value="${WEB}"]`)).toHaveCount(1);
    await expect(teamSelect.locator(`option[value="${PLATFORM}"]`)).toHaveCount(0);
    await teamSelect.selectOption(WEB);
    await page.getByTestId('effort-csv').click();
    const dialog = page.getByTestId('effort-csv-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('csv-download')).toBeDisabled(); // no dates yet
    // "Last X days ending today": 7 -> 7 days including today, today being the app's date.
    await page.getByTestId('csv-last-days').fill('7');
    const span = async () =>
      (Date.parse(await page.getByTestId('csv-to').inputValue()) -
        Date.parse(await page.getByTestId('csv-from').inputValue())) /
      86_400_000;
    expect(await page.getByTestId('csv-to').inputValue()).toBe('2026-06-15'); // APP_FAKE_NOW
    expect(await span()).toBe(6);
    await page.getByTestId('csv-last-days').fill('30');
    expect(await span()).toBe(29);
    await shot('effort-csv-dialog');
    await axe('effort-csv-dialog');
    // A backwards range is caught before it is sent.
    await page.getByTestId('csv-from').fill('2026-06-12');
    await page.getByTestId('csv-to').fill('2026-06-11');
    await expect(page.getByTestId('csv-download')).toBeDisabled();
    // The filled dates stay editable, and the edited ones are what is sent.
    await page.getByTestId('csv-last-days').fill('14');
    await page.getByTestId('csv-from').fill('2026-06-03');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('csv-download').click(),
    ]);
    expect(download.url()).toContain(`teamId=${WEB}`);
    expect(download.url()).toContain('from=2026-06-03&to=2026-06-15');
    expect(download.suggestedFilename()).toMatch(/^effort-.*\.csv$/);
  });
});

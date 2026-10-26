// D-116 time log at three viewports: My time (log on a card from the page, days off, week note),
// the same entry on the card's Time tab, no Time tab on a private card, and Team time for an
// admin; an ordinary member has no Team time.
// The e2e clock is Monday 2026-06-15; each viewport works in its own later week (+1..+3) so the
// runs never see each other's hours.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; title: string };
}

function weeksAhead(page: Page): number {
  const width = page.viewportSize()?.width ?? 0;
  return width >= 1024 ? 1 : width >= 640 ? 2 : 3;
}

async function goToWeek(page: Page, ahead: number) {
  for (let i = 0; i < ahead; i++) {
    const before = await page.getByTestId('week-label').textContent();
    await page.getByTestId('week-next').click();
    await expect(page.getByTestId('week-label')).not.toHaveText(before ?? '');
  }
}

test.describe('D-116 time log', () => {
  test('My time: log on a card from the page, mark a day off, write the week note', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const ahead = weeksAhead(page);
    const title = `Timelog ${ahead} ${Date.now()} with a deliberately long title that must stay inside the picker box`;
    const card = await apiCreate(page, { title, plane: 'org', teamId: PLATFORM });
    await page.goto('/time');
    await expect(page.getByTestId('week-label')).toHaveAttribute('data-week', '2026-06-15');
    await goToWeek(page, ahead);
    const monday = ['2026-06-22', '2026-06-29', '2026-07-06'][ahead - 1] ?? '';
    await expect(page.getByTestId('week-label')).toHaveAttribute('data-week', monday);

    // Open the card list, search it by title, pick the card; log 1.5 h on Monday (D-121).
    await page.getByTestId('time-card').click();
    await page.getByTestId('time-card-search').fill(title);
    await page.getByTestId(`time-card-option-${card.key}`).click();
    await expect(page.getByTestId('time-card')).toContainText(card.key);
    // A long title ends in an ellipsis inside the box, never past its edge.
    const spills = await page
      .getByTestId('time-card')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(spills).toBe(false);
    await page.getByTestId('time-log-date').selectOption(monday);
    await page.getByTestId('time-log-hours').fill('1.5');
    await page.getByTestId('time-log-note').fill('from the time page');
    await page.getByTestId('time-log-submit').click();
    await expect(page.getByText(`Logged 1.5 h on ${card.key}.`)).toBeVisible();
    await expect(page.getByTestId('my-entry').filter({ hasText: card.key })).toHaveCount(1);
    await expect(page.getByTestId(`day-${monday}`)).toContainText('1.5 h');

    // A leave day lowers the target; the week note is kept.
    const friday = await page
      .getByTestId('my-days')
      .locator('li')
      .last()
      .getAttribute('data-testid');
    const fridayDate = (friday ?? '').replace('day-', '');
    // D-154: days off and the note open from "Add note".
    await page.getByTestId('note-add').click();
    await page.getByTestId(`day-off-${fridayDate}`).selectOption('leave');
    await expect(page.getByTestId(`day-${fridayDate}`)).toContainText('Leave');
    await expect(page.getByTestId('week-summary')).toContainText('of 32 h');
    await page.getByTestId('week-note').fill('client workshop on Friday');
    await page.getByTestId('week-note-save').click();
    await expect(page.getByText('Note saved.')).toBeVisible();
    await shot('my-time');
    await axe('my-time');

    // D-120: the month view shows the whole month, the same entry included.
    await page.getByTestId('view-month').click();
    await expect(page.getByTestId('week-label')).toHaveAttribute(
      'data-week',
      `${monday.slice(0, 7)}-01`,
    );
    await expect(page.getByTestId('my-entry').filter({ hasText: card.key })).toHaveCount(1);
    await expect(page.getByTestId('month-adjust-hint')).toBeVisible();
    await shot('my-time-month');
    await page.getByTestId('view-week').click();

    // The same entry is on the card's Time tab.
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-time').click();
    await expect(page.getByTestId('time-entry')).toHaveCount(1);
    await expect(page.getByTestId('time-entry')).toContainText('from the time page');
    // History says it in words, not JSON (D-117 note).
    await page.getByTestId('tab-history').click();
    const logged = page.getByTestId('event').filter({ hasText: 'Time logged' });
    await expect(logged).toContainText('1.5 h on');
    await expect(logged).not.toContainText('entryId');

    // A private card has no Time tab (D-116 b).
    const mine = await apiCreate(page, { title: `Private ${Date.now()}`, plane: 'private' });
    await page.goto(`/cards/${mine.key}`);
    await expect(page.getByTestId('tab-details')).toBeVisible();
    await expect(page.getByTestId('tab-time')).toHaveCount(0);
  });

  test('Team time: an admin sees a member and their work on the team; a member is refused', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const ahead = weeksAhead(page);
    const monday = ['2026-06-22', '2026-06-29', '2026-07-06'][ahead - 1] ?? '';
    const title = `Team work ${ahead} ${Date.now()}`;
    const card = await apiCreate(page, { title, plane: 'org', teamId: PLATFORM });
    const res = await page.request.post(`/api/v1/cards/${card.key}/time`, {
      headers: CSRF,
      data: { date: monday, hours: 2, note: 'pairing' },
    });
    expect(res.status(), await res.text()).toBe(201);
    // An ordinary member has no Team time (M2: no spec leaves them a lead, see cr13-21).
    await signInViaApi(page, 'M2');
    await page.goto('/team-time');
    await expect(page.getByTestId('permission-denied')).toBeVisible();

    await signInViaApi(page, 'ADMIN');
    await page.goto(`/team-time?team=${PLATFORM}`);
    await expect(page.getByTestId('team-time-team')).toHaveValue(PLATFORM);
    await expect(page.getByTestId('week-label')).toHaveAttribute('data-week', '2026-06-15');
    await goToWeek(page, ahead);
    await expect(page.getByTestId('team-time')).toContainText('Meera Member');
    // D-156: one work table for the team; the member's "..." menu narrows it to them.
    await page
      .getByTestId(`member-menu-${fixtureId('M1')}`)
      .locator('summary')
      .click();
    await page.getByTestId(`show-work-${fixtureId('M1')}`).click();
    await expect(page.getByTestId('work-member')).toHaveValue(fixtureId('M1'));
    await expect(
      page.getByTestId('team-work').getByTestId('team-entry').filter({ hasText: title }),
    ).toContainText('pairing');
    await shot('team-time');
    await axe('team-time');
  });
});

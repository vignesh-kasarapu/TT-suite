// D-150 at desktop / tablet / mobile: the board look from the user's mockup - the Calendar tab on
// every board, top-bar search and Create, the card's "..." menu (Move to), the Filters button with
// its count, the "+" on a column, and the side-nav summary.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number };
}

/** Today on this machine, as the browser's calendar shows it. */
function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test.describe('D-150 board look', () => {
  test('the Calendar tab shows cards on their ETA on every board', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const today = todayIso();
    const due = await apiCreate(page, {
      title: `Due today ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
      eta: today,
    });
    for (const url of ['/calendar', `/teams/${PLATFORM}/calendar`, '/unassigned/calendar']) {
      await page.goto(url);
      await expect(page.getByTestId('calendar')).toBeVisible();
      await expect(
        page.getByTestId('backlog-switch').getByRole('link', { name: 'Calendar' }),
      ).toHaveAttribute('aria-current', 'page');
    }
    await page.goto('/org/calendar');
    // A day shows three cards; narrow the board to this one (the calendar follows the filters).
    await page.getByTestId('filter-q').fill(due.key);
    const day = page.getByTestId(`calendar-day-${today}`);
    await expect(day.getByTestId(`calendar-card-${due.key}`)).toBeVisible();
    await expect(page.getByTestId('calendar-no-eta')).toContainText('without an ETA');
    await shot('board-calendar');
    await axe('board-calendar');
    // Next month and back.
    const month = await page.getByTestId('calendar-month').textContent();
    await page.getByTestId('calendar-next').click();
    await expect(page.getByTestId('calendar-month')).not.toHaveText(month ?? '');
    await page.getByTestId('calendar-prev').click();
    await expect(page.getByTestId('calendar-month')).toHaveText(month ?? '');
    // A card opens over the Board tab.
    await page.getByTestId(`calendar-card-${due.key}`).click();
    await expect(page).toHaveURL(new RegExp(`/org/cards/${due.key}$`));
  });

  test('top bar: search goes to the Search page; Create makes an org card', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    await page.goto('/teams');
    if (width >= 640) {
      // The shortcut listener starts once the top bar has mounted; a press before that is lost
      // (seen on the slower CI runner), so wait for the bar and retry the press until it lands.
      await expect(page.getByTestId('top-search')).toBeVisible();
      await expect(async () => {
        await page.keyboard.press('Control+k');
        await expect(page.getByTestId('top-search')).toBeFocused({ timeout: 1000 });
      }).toPass();
      await page.getByTestId('top-search').fill('Planet');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/search\?q=Planet$/);
    } else {
      // Phones reach Search from the More sheet; the bar keeps only Create.
      await expect(page.getByTestId('top-search')).toBeHidden();
    }
    await page.getByTestId('create-open').click();
    await shot('create-menu');
    await page.getByTestId('create-org').click();
    const title = `From the top bar ${width} ${Date.now()}`;
    await page.getByTestId('new-card-title').fill(title);
    await page.getByTestId('new-card-submit').click();
    await expect(page).toHaveURL(/\/org\/cards\/K-\d+$/);
    await expect(page.getByTestId('detail-title')).toHaveValue(title);
  });

  test('card menu moves a card; Filters counts its ticks; a column "+" creates in that column', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const card = await apiCreate(page, {
      title: `Menu move ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
      priority: 1,
      eta: todayIso(),
    });
    await page.goto(`/teams/${PLATFORM}`);
    const face = page.getByTestId(`card-${card.key}`);
    await expect(face.getByTitle(/^Priority 1/)).toBeVisible();
    await expect(face.getByTestId('card-assignee')).toHaveAttribute('title', /Meera Member/);
    // The "..." menu holds Move to.
    await face.locator('summary').click();
    await expect(page.getByTestId(`move-${card.key}`)).toBeVisible();
    await shot('card-menu-open');
    await axe('card-menu-open');
    await page.getByTestId(`move-${card.key}`).selectOption('ready');
    if (width < 640) await page.getByTestId('column-switcher').selectOption('ready');
    await expect(page.getByTestId('column-ready').getByTestId(`card-${card.key}`)).toBeVisible();

    // Filters: the badge counts the ticks that are on.
    await page.getByTestId('filters-open').click();
    await page.getByTestId('filter-closed').check();
    await page.getByTestId('filter-group').check();
    await expect(page.getByTestId('filters-open')).toContainText('2');
    await page.getByTestId('filter-group').uncheck();
    await page.getByTestId('filter-closed').uncheck();
    await expect(page.getByTestId('filters-open')).not.toContainText(/\d/);
    await page.getByTestId('filters-open').click();

    // "+" on Ready starts the card in Ready.
    if (width < 640) await page.getByTestId('column-switcher').selectOption('ready');
    await page.getByTestId('column-add-ready').click();
    const title = `Straight to Ready ${width} ${Date.now()}`;
    await page.getByTestId('new-card-title').fill(title);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/cards') && r.request().method() === 'POST',
      ),
      page.getByTestId('new-card-submit').click(),
    ]);
    expect(res.status(), await res.text()).toBe(201);
    expect(((await res.json()) as { state: string }).state).toBe('ready');
  });

  test('the side nav ends with my teams summary (desktop)', async ({ page, shot }) => {
    const width = page.viewportSize()?.width ?? 0;
    await signInViaApi(page, 'M1');
    await page.goto('/teams');
    const summary = page.getByTestId('org-summary');
    if (width < 1024) {
      await expect(summary).toHaveCount(0);
      return;
    }
    await expect(summary).toContainText(/\d+ projects · \d+ tasks/);
    await expect(summary.getByRole('img')).toHaveAccessibleName(/\d+% delivered/);
    await shot('nav-summary');
    await summary.click();
    await expect(page).toHaveURL(/\/org$/);
  });
});

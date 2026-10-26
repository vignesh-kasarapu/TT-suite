// S1 private board and card detail at desktop / tablet / mobile (FR-050..055, FR-040..042).
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

// D-067: Backlog lives on its own tab; the Board tab shows the working columns (UAT gone, D-112).
// D-089: Cancelled is a hidden column until "Show cancelled" is ticked.
const STATE_HEADINGS = ['In Prep', 'Ready', 'In-Progress', 'UAT', 'Delivered'];

test.describe('S1 board', () => {
  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, 'M1');
  });

  test('board renders per viewport: 8 columns (>= 640) or one column + switcher (< 640); create a card; it lands in Backlog', async ({
    page,
    shot,
    axe,
  }) => {
    const width = page.viewportSize()?.width ?? 0;
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'My board' })).toBeVisible();
    const columns = page.getByTestId('columns');
    await expect(columns).toBeVisible();
    if (width >= 640) {
      for (const h of STATE_HEADINGS)
        await expect(
          columns.getByRole('heading', { level: 2, name: new RegExp(`^${h}`) }),
        ).toBeVisible();
      await expect(page.getByTestId('column-switcher')).toHaveCount(0);
      await expect(columns.getByRole('heading', { level: 2, name: /^Cancelled/ })).toHaveCount(0);
      await page.getByTestId('filters-open').click();
      await page.getByTestId('filter-cancelled').click();
      await expect(page.getByTestId('filters-open')).toContainText('1');
      await expect(columns.getByRole('heading', { level: 2, name: /^Cancelled/ })).toBeVisible();
      await page.getByTestId('filter-cancelled').click();
      // D-150: Escape closes the Filters menu, as a click outside it does.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('filter-cancelled')).toBeHidden();
    } else {
      await expect(columns.getByRole('heading', { level: 2 })).toHaveCount(1);
      const switcher = page.getByTestId('column-switcher');
      await expect(switcher).toBeVisible();
      await switcher.selectOption('ready');
      await expect(columns.getByRole('heading', { level: 2, name: /^Ready/ })).toBeVisible();
      await switcher.selectOption('in_prep');
    }

    const title = `E2E card ${width} ${Date.now()}`;
    await page.getByTestId('column-add-in_prep').click();
    await page.getByTestId('new-card-title').fill(title);
    await page.getByTestId('new-card-submit').click();
    // Creating opens the detail; the title is shown there.
    await expect(page.getByTestId('card-title')).toHaveText(title);
    // D-079: icon-only controls and abbreviations carry hover tooltips.
    await expect(page.getByTestId('card-close')).toHaveAttribute('title', 'Close');
    await page.getByTestId('card-close').click();
    // From the Board tab a new card starts In Prep (D-067); the Backlog tab lists Backlog cards.
    await expect(page.getByTestId('column-in_prep').getByText(title)).toBeVisible();
    // D-134: a new card has no priority, so its face shows no priority pill.
    const face = page.getByTestId('column-in_prep').locator('li', { hasText: title });
    await expect(face.getByTitle(/^Priority \d/)).toHaveCount(0);
    await page.getByTestId('backlog-switch').getByRole('link', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(/\/backlog$/);
    await expect(page.getByTestId('column-backlog')).toBeVisible();
    await page.getByTestId('column-add-backlog').click();
    await page.getByTestId('new-card-title').fill(`${title} B`);
    await page.getByTestId('new-card-submit').click();
    await expect(page.getByTestId('card-title')).toHaveText(`${title} B`);
    await page.getByTestId('card-close').click();
    await expect(page).toHaveURL(/\/backlog$/);
    // D-152: the Backlog table pages and sorts by priority, so look the new card up by title.
    await page.getByTestId('filter-q').fill(`${title} B`);
    await expect(page.getByTestId('column-backlog').getByText(`${title} B`)).toBeVisible();
    await shot('board');
    await axe('board');
  });

  test('card detail: edit fields, move state via keyboard select, comment, history; version conflict shows a message', async ({
    page,
    shot,
    axe,
    browser,
  }) => {
    const width = page.viewportSize()?.width ?? 0;
    await page.goto('/');
    const title = `Detail card ${width} ${Date.now()}`;
    await page.getByTestId('column-add-in_prep').click();
    await page.getByTestId('new-card-title').fill(title);
    await page.getByTestId('new-card-submit').click();
    await expect(page.getByTestId('card-title')).toHaveText(title);
    await expect(page).toHaveURL(/\/cards\/K-\d+$/);
    const key = page.url().split('/cards/')[1] as string;
    // Panel above 640 (board still behind), page below.
    if (width >= 640) await expect(page.getByTestId('card-panel')).toBeVisible();
    else await expect(page.getByTestId('card-page')).toBeVisible();

    // D-134: a new card has no priority until one is chosen.
    await expect(page.getByTestId('detail-priority')).toHaveValue('');
    // Details: description with markdown, priority, ETA, effort, tags -> Save.
    await page.getByTestId('detail-description').fill('Some **bold** text\n\n- one\n- two');
    await expect(page.getByTestId('detail-preview').locator('strong')).toHaveText('bold');
    await expect(page.getByTestId('detail-preview').locator('li')).toHaveCount(2);
    await page.getByTestId('detail-priority').selectOption('1');
    await page.getByTestId('detail-eta').fill('2026-07-01');
    await page.getByTestId('detail-effort').fill('3.5');
    // Tags come from the admin vocabulary (D-062): pick chips, no free text.
    await page.getByTestId('detail-tags').getByTestId('tag-urgent').click();
    await page.getByTestId('detail-tags').getByTestId('tag-e2e').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // D-133: Save closes the card; the confirmation shows at the bottom of the board.
    await expect(page.getByTestId('flash')).toHaveText(`${key} saved.`);
    await expect(page).not.toHaveURL(/\/cards\//);
    // D-079: abbreviations carry a hover tooltip - the P1 pill names the priority in full.
    await expect(page.getByTestId(`card-${key}`).getByTitle('Priority 1 - highest')).toBeVisible();
    await page.goto(`/cards/${key}`);
    await expect(page.getByText('Version 2')).toBeVisible();

    // Move via the detail state select (keyboard-accessible alternative to drag).
    await page.getByTestId('detail-state').selectOption('in_development');
    await expect(page.getByText('Version 3')).toBeVisible();

    // Comments.
    await page.getByTestId('tab-comments').click();
    await page.getByTestId('comment-body').fill('First *note*');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    await expect(page.getByTestId('comment').locator('em')).toHaveText('note');
    await page.getByTestId('comment-edit').click();
    await page.getByTestId('comment-edit-body').fill('Edited note');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('comment')).toContainText('Edited note');
    await expect(page.getByTestId('comment')).toContainText('(edited)');

    // History: created + 5 field events + state + comment_added + comment_edited.
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('event').first()).toBeVisible();
    await expect(page.getByTestId('event')).toHaveCount(9);
    await page.getByTestId('history-filter').selectOption('eta');
    await expect(page.getByTestId('event')).toHaveCount(1);
    await expect(page.getByTestId('event').first()).toContainText('2026-07-01');
    await shot('card-detail');
    await axe('card-detail');

    // Version conflict: another session moves the card; this stale form then fails with STALE_VERSION.
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await signInViaApi(p2, 'M1');
    const cur = await p2.request.get(`/api/v1/cards/${key}`);
    const { version } = (await cur.json()) as { version: number };
    const mv = await p2.request.post(`/api/v1/cards/${key}/move`, {
      headers: { 'X-Requested-With': 'XHR' },
      data: { state: 'uat', version },
    });
    expect(mv.status()).toBe(200);
    await other.close();
    await page.getByTestId('tab-details').click();
    await page.getByTestId('detail-title').fill(`${title} again`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('card-error')).toContainText(/changed|Reload/);

    // Direct URL opens the same card.
    await page.goto(`/cards/${key}`);
    await expect(page.getByTestId('card-title')).toHaveText(title);
  });

  test('another user cannot open my card by URL (404 page), and filters narrow the board', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const mine = `Private only ${Date.now()}`;
    await page.getByTestId('column-add-in_prep').click();
    await page.getByTestId('new-card-title').fill(mine);
    await page.getByTestId('new-card-submit').click();
    await expect(page).toHaveURL(/\/cards\/K-\d+$/);
    const key = page.url().split('/cards/')[1] as string;
    await page.getByTestId('card-close').click();
    // Wait for the card window (CR-25 modal) to unmount: the URL changes first, and typing
    // before the <dialog> is gone lands on the inert board behind it.
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    await page.getByTestId('filter-q').fill(mine);
    await expect(page.getByTestId(`card-${key}`)).toBeVisible();
    await page.getByTestId('filter-q').fill('zzz-no-such-card');
    await expect(page.getByTestId(`card-${key}`)).toHaveCount(0);

    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p2 = await other.newPage();
    await signInViaApi(p2, 'M2');
    await p2.goto(`/cards/${key}`);
    await expect(p2.getByText(`Card ${key} does not exist or is not yours.`)).toBeVisible();
    await other.close();
  });
});

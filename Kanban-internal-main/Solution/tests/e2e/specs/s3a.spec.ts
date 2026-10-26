// S3a at three viewports: Inbox with badge (D-066), Backlog tab (D-067, covered in board.spec),
// threaded comments + votes (D-068), Files tab + project Documents (D-069).
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

test.describe('S3a', () => {
  // The inbox test moves the app clock a year ahead; put it back even when that test fails, so a
  // failure there cannot knock over the specs that follow (CI once saw reports dated 2027).
  test.afterEach(async ({ page }) => {
    const r = await page.request.put('/api/v1/dev/clock', {
      headers: CSRF,
      data: { now: '2026-06-15T04:30:00Z' },
    });
    expect(r.status()).toBe(204);
  });

  test('comments: reply to a comment, vote it up, thumbs count shows; delete of a parent with replies is refused', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const card = await apiCreate(page, {
      title: `Thread ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
    });
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-comments').click();
    await page.getByTestId('comment-body').fill('First thought');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    await page.getByTestId('comment-reply').click();
    await page.getByTestId('reply-body').fill('A reply');
    await page.getByTestId('reply-form').getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByTestId('reply')).toHaveCount(1);
    await page.getByTestId('comment').first().getByTestId('vote-up').first().click();
    await expect(page.getByTestId('comment').first().getByTestId('vote-up').first()).toContainText(
      '1',
    );
    await shot('comments-thread');
    await page.getByTestId('comment').first().getByTestId('comment-delete').first().click();
    await expect(page.getByTestId('comments').getByRole('alert')).toContainText(/replies/);
  });

  test('files: add a link on the card; it appears under the project Documents grouped by card', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'ADMIN');
    const stamp = Date.now();
    const proj = await page.request.post('/api/v1/projects', {
      headers: CSRF,
      data: { name: `Docs ${stamp}`, teamId: PLATFORM },
    });
    expect(proj.status()).toBe(201);
    const projectId = ((await proj.json()) as { id: string }).id;
    const card = await apiCreate(page, { title: `Filed ${stamp}`, plane: 'org', projectId });
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-files').click();
    await page.getByTestId('attachment-title').fill('Design notes');
    await page.getByTestId('attachment-url').fill('https://sharepoint.example.test/design');
    await page.getByTestId('attachment-kind').selectOption('design');
    await page.getByTestId('attachment-add').click();
    await expect(page.getByTestId('attachment')).toHaveCount(1);
    await expect(page.getByTestId('attachment')).toContainText('Design notes');
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByTestId('documents')).toBeVisible();
    await page
      .getByTestId('project-attachment-form')
      .getByTestId('attachment-title')
      .fill('Charter');
    await page
      .getByTestId('project-attachment-form')
      .getByTestId('attachment-url')
      .fill('https://sharepoint.example.test/charter');
    await page.getByTestId('project-attachment-form').getByTestId('attachment-add').click();
    await expect(page.getByTestId('documents').getByTestId('attachment')).toHaveCount(2);
    await expect(page.getByTestId(`docs-card-${card.key}`)).toContainText('Design notes');
    await shot('documents');
  });

  test('inbox: an assignment by someone else shows unread with a badge; the filters and groups narrow it; opening one marks it read; mark seen and clear-by-date empty it', async ({
    page,
    browser,
    shot,
    axe,
  }) => {
    // The e2e app runs on the dev clock (APP_FAKE_NOW). Drive it explicitly so "since I last
    // looked" is deterministic regardless of what earlier runs left in the shared database.
    const clock = async (now: string) => {
      const r = await page.request.put('/api/v1/dev/clock', { headers: CSRF, data: { now } });
      expect(r.status()).toBe(204);
    };
    // Every run gets its own instant, a year ahead of real time, so this run's events are newer
    // than anything an earlier run left behind - the inbox is newest-first since CR-15, and a
    // fixed fake clock would tie every run's events at the same second.
    const base = Date.now() + 365 * 86_400_000;
    const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
    // The day after, so the browser's local end-of-day is past this run's events in any zone.
    const clearDay = at(24 * 60).slice(0, 10);
    // Sessions are 24 h from the app clock: move the clock first, then sign in.
    await clock(at(0));
    await signInViaApi(page, 'M2');
    expect((await page.request.post('/api/v1/inbox/seen', { headers: CSRF })).status()).toBe(204);
    await clock(at(1));
    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p1 = await other.newPage();
    await signInViaApi(p1, 'M1');
    const card = await apiCreate(p1, { title: `Inbox ${Date.now()}`, plane: 'org' });
    await makeTeamless(card.key); // CR-22: a legacy team-less card, which the "No team" filter needs
    const res = await p1.request.patch(`/api/v1/cards/${card.key}`, {
      headers: CSRF,
      data: { version: 1, assigneeId: fixtureId('M2') },
    });
    expect(res.status()).toBe(200);
    await other.close();
    await clock(at(2));
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { level: 1, name: /Inbox/ })).toBeVisible();
    await expect(
      page.getByTestId('inbox-item-unread').filter({ hasText: card.key }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('bell-count')).toBeVisible(); // D-122: the count is on the bell
    // CR-16 / D-158: the entry sits in the Assignments tab, which carries its own total; All
    // shows every group. CR-15: newest-first, so this run's assignment is the tab's first row.
    const assignments = page.getByTestId('inbox-tab-assignments');
    await expect(assignments).toContainText('Assignments');
    await assignments.click();
    await expect(assignments).toHaveAttribute('aria-selected', 'true');
    const rows = page.getByTestId('inbox-items-assignments');
    await expect(rows.locator('[data-testid^="inbox-item"]').first()).toContainText(card.key);
    await page.getByTestId('inbox-tab-all').click();
    await expect(page.getByTestId('inbox-items-assignments')).toHaveCount(0);
    await expect(page.getByTestId('inbox-items-all')).toBeVisible();
    await assignments.click();
    await expect(page.getByTestId('inbox-items-assignments')).toBeVisible();
    await shot('inbox');
    await axe('inbox');

    // CR-15: the card has no team, so "No team" keeps it and a real team drops it. The shared
    // database carries earlier runs, so every check is on this card, never on a count.
    const mineHere = rows.filter({ hasText: card.key });
    await page.getByTestId('inbox-filter-team').selectOption('none');
    await expect(mineHere).toHaveCount(1);
    await expect(page.getByTestId('inbox-filter-project')).toBeDisabled();
    await page.getByTestId('inbox-filter-team').selectOption(PLATFORM);
    await expect(mineHere).toHaveCount(0);
    await page.getByTestId('inbox-filter-team').selectOption('');
    // ... and "Assigned to me" keeps it, because M2 now holds it.
    await page.getByTestId('inbox-filter-mine').check();
    await expect(mineHere).toHaveCount(1);
    await page.getByTestId('inbox-filter-mine').uncheck();

    // CR-19: opening the entry marks that one entry read, without touching the rest. Wait for the
    // mark-read call before reloading: a full reload right after the click can cancel it.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/v1/inbox/read') && r.request().method() === 'POST',
      ),
      rows.getByText(card.key).first().click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`/cards/${card.key}`));
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox-item-unread').filter({ hasText: card.key })).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId('inbox-item').filter({ hasText: card.key }).first(),
    ).toBeVisible();

    await page.getByTestId('inbox-seen').click();
    await expect(page.getByTestId('inbox-item-unread')).toHaveCount(0);
    await expect(page.getByTestId('inbox-seen')).toHaveCount(0);

    // CR-19: clear by date empties the inbox; the card keeps its history either way (FR-041).
    await page.getByTestId('inbox-clear-date').fill(clearDay);
    await page.getByTestId('inbox-clear').click();
    await expect(page.getByTestId('inbox-items-assignments')).toHaveCount(0);
    await shot('inbox-cleared');
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('event').first()).toBeVisible();
    // Undo the clear for later runs against this shared database (as with the clock below).
    expect(
      (
        await page.request.post('/api/v1/inbox/clear', {
          headers: CSRF,
          data: { before: '2020-01-01T00:00:00Z' },
        })
      ).status(),
    ).toBe(204);
    // The fixture clock is restored by afterEach.
  });
});

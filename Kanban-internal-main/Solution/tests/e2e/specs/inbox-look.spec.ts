// D-158 at desktop / tablet / mobile: @mentions and the Inbox of the user's mockup - "@" in a
// comment offers the people who may read the card and writes a mention; the person named finds
// it under Mentions ("Mentioned you"); a status change reads "In Prep -> Ready"; the row menu
// marks one read; the top bar shows an envelope. Works on whatever day the app is in.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number };
}

test.describe('D-158 mentions and inbox', () => {
  test('mention Meera, she finds it under Mentions; state change named; mark read', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const card = await apiCreate(page, {
      title: `Mention me ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });

    // The admin mentions Meera through the "@" picker, and moves her card on.
    await signInViaApi(page, 'ADMIN');
    await page.goto(`/cards/${card.key}`);
    await page.getByTestId('tab-comments').click();
    const box = page.getByTestId('comment-body');
    await box.fill('Please check, @Mee');
    await expect(page.getByTestId('mention-list')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(box).toHaveValue(new RegExp(`@\\[Meera Member\\]\\(user:${fixtureId('M1')}\\) `));
    await page.getByRole('button', { name: 'Add comment' }).click();
    await expect(page.getByTestId('comment').last()).toContainText('@Meera Member');
    const moved = await page.request.post(`/api/v1/cards/${card.key}/move`, {
      headers: CSRF,
      data: { state: 'ready', version: card.version + 1 },
    });
    expect(moved.status(), await moved.text()).toBe(200);

    // Meera: Mentions holds it, marked "Mentioned you"; the state change names both states.
    await signInViaApi(page, 'M1');
    await page.goto('/inbox');
    await expect(page.getByTestId('bell')).toBeVisible();
    await page.getByTestId('inbox-tab-mentions').click();
    const mention = page
      .getByTestId('inbox-items-mentions')
      .locator('[data-testid^="inbox-item"]')
      .filter({ hasText: card.key })
      .first();
    await expect(mention).toContainText('Mentioned you');
    await page.getByTestId('inbox-tab-status_changes').click();
    const change = page
      .getByTestId('inbox-items-status_changes')
      .locator('[data-testid^="inbox-item"]')
      .filter({ hasText: card.key })
      .first();
    await expect(change).toContainText('In Prep');
    await expect(change).toContainText('Ready');
    await shot('inbox-look');
    await axe('inbox-look');

    // The row menu marks just that one read.
    await expect(change).toHaveAttribute('data-testid', 'inbox-item-unread');
    await change.locator('summary').click();
    await change.getByTestId('inbox-mark-read').click();
    await expect(
      page
        .getByTestId('inbox-items-status_changes')
        .getByTestId('inbox-item')
        .filter({ hasText: card.key }),
    ).toHaveCount(1);
  });
});

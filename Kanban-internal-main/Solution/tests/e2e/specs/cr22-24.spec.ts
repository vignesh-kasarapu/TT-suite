// CR-22 + CR-24 at desktop / tablet / mobile: the new-card dialog always carries a team (here the
// creator's only one, even on the Unassigned board), and a closed card is read-only - its move
// select and its form are locked, it says why, and its comments stay open. CR-23 (Claim) is in
// org.spec and cr17.spec.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number };
}

test.describe('CR-22 + CR-24', () => {
  test('CR-22: a new card from the Unassigned board starts with the creator’s team', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    await page.goto('/unassigned');
    await page.getByTestId('column-add-in_prep').click();
    await expect(page.getByTestId('new-card-team')).toHaveValue(PLATFORM);
    await shot('new-card-team-default');
  });

  test('CR-24: a closed card is read-only and says so; comments stay open', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const card = await apiCreate(page, {
      title: `CR24 shipped ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'delivered',
    });
    await page.goto(`/teams/${PLATFORM}`);
    // Phones show one column at a time.
    if (width < 640) await page.getByTestId('column-switcher').selectOption('delivered');
    await expect(page.getByTestId(`move-${card.key}`)).toBeDisabled();

    await page.goto(`/cards/${card.key}`);
    await expect(page.getByTestId('card-read-only')).toContainText('closed');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.getByTestId('detail-state')).toBeDisabled();
    await shot('closed-card');
    await axe('closed-card');

    await page.getByTestId('tab-comments').click();
    await page.getByTestId('comment-body').fill('Feedback after delivery');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    await shot('closed-card-comment');
  });
});

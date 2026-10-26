// D-126/D-127/D-147 at three viewports: the new-card dialog picks the assignee - Me by default or
// a teammate, never nobody (D-147: the creator holds a card nobody is named for) - and someone
// invited who has not signed in yet is never offered (the server would refuse them).
import { expect, test } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

test.describe('D-127 new-card assignee', () => {
  test('a new card is never unassigned; invited people are not offered', async ({
    page,
    shot,
    axe,
  }) => {
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    await signInViaApi(page, 'ADMIN');
    const invite = await page.request.post('/api/v1/users', {
      headers: CSRF,
      data: {
        name: `Invitee ${stamp}`,
        email: `invitee-${stamp}@example.test`,
        teamIds: [PLATFORM],
      },
    });
    expect(invite.status(), await invite.text()).toBe(201);
    const invitedId = ((await invite.json()) as { id: string }).id;

    await signInViaApi(page, 'M1');
    await page.goto(`/teams/${PLATFORM}`);
    await page.getByTestId('column-add-in_prep').click();
    const assignee = page.getByTestId('new-card-assignee');
    await expect(assignee).toHaveValue('me');
    await expect(assignee.locator(`option[value="${invitedId}"]`)).toHaveCount(0);
    await expect(assignee.locator('option[value=""]')).toHaveCount(0);
    await page.getByTestId('new-card-title').fill(`Mine from the start ${stamp}`);
    await shot('new-card-assignee');
    await axe('new-card-assignee');
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/cards') && r.request().method() === 'POST',
      ),
      page.getByTestId('new-card-submit').click(),
    ]);
    expect(res.status(), await res.text()).toBe(201);
    const card = (await res.json()) as { key: string; assigneeId: string | null };
    expect(card.assigneeId).toBe(fixtureId('M1'));
    // The server holds the line too: an explicit "nobody" still lands on the creator.
    const direct = await page.request.post('/api/v1/cards', {
      headers: CSRF,
      data: { title: `Nobody ${stamp}`, plane: 'org', teamId: PLATFORM, assigneeId: null },
    });
    expect(direct.status(), await direct.text()).toBe(201);
    expect(((await direct.json()) as { assigneeId: string | null }).assigneeId).toBe(
      fixtureId('M1'),
    );
  });

  test('a card created on the Unassigned page is the creator’s and shows on their Org board', async ({
    page,
  }) => {
    const title = `Unassigned start ${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    await signInViaApi(page, 'M1');
    await page.goto('/unassigned');
    await page.getByTestId('column-add-in_prep').click();
    await expect(page.getByTestId('new-card-assignee')).toHaveValue('me');
    await page.getByTestId('new-card-title').fill(title);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/cards') && r.request().method() === 'POST',
      ),
      page.getByTestId('new-card-submit').click(),
    ]);
    expect(res.status(), await res.text()).toBe(201);
    const card = (await res.json()) as { key: string; assigneeId: string | null };
    expect(card.assigneeId).toBe(fixtureId('M1'));
    await page.getByTestId('card-close').click();
    await expect(page).toHaveURL(/\/unassigned$/);
    await expect(page.getByTestId(`card-${card.key}`)).toHaveCount(0);
    await page.goto('/org');
    // The Board tab creates In Prep cards (D-067); phones show one column at a time.
    if ((page.viewportSize()?.width ?? 0) < 640)
      await page.getByTestId('column-switcher').selectOption('in_prep');
    await expect(page.getByTestId(`card-${card.key}`)).toBeVisible();
  });
});

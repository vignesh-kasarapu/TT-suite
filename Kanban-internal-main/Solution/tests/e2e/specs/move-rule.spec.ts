// D-117 at three viewports: only the person working on a card moves it. An unassigned card can't
// be moved (no drag, move menu disabled) until it is claimed; then it can. The Time tab's log
// form sits above the entries.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';
import { makeUnheld } from './_fixtures/legacy';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; canMove: boolean };
}

test.describe('D-117 move rule', () => {
  test('an unassigned card is claimed before it can be moved', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M1');
    const stamp = `${page.viewportSize()?.width ?? 0} ${Date.now()}`;
    const card = await apiCreate(page, {
      title: `Move rule ${stamp}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });
    await makeUnheld(card.key);
    await page.goto('/unassigned');
    const face = page.getByTestId(`card-${card.key}`);
    await expect(face).toBeVisible();
    await expect(face).toHaveAttribute('draggable', 'false');
    await expect(page.getByTestId(`move-${card.key}`)).toBeDisabled();
    await shot('move-rule-unclaimed');
    await axe('move-rule-unclaimed');

    // Claim it: now it is mine to move.
    await page.getByTestId(`claim-${card.key}`).click();
    await page.goto(`/cards/${card.key}`);
    await expect(page.getByTestId('detail-state')).toBeEnabled();
    await page.getByTestId('detail-state').selectOption('ready');
    await expect(page.getByTestId('detail-state')).toHaveValue('ready');

    // The Time tab opens on its log form, above the entries.
    await page.getByTestId('tab-time').click();
    const form = page.getByTestId('time-add');
    const total = page.getByTestId('time-total');
    const formBox = await form.boundingBox();
    const totalBox = await total.boundingBox();
    expect(formBox!.y).toBeLessThan(totalBox!.y);
  });
});

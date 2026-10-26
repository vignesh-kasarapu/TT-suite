// CR-17 + CR-20 at desktop / tablet / mobile: the Unassigned board's two senses and its mode
// filter (FR-052, FR-075), clearing an assignee sending a card to Backlog, and the person on every
// board card - assignee, or the owner marked "raised by" when nobody holds it (CR-20).
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';
import { makeTeamless, makeUnheld } from './_fixtures/legacy';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number; id: string };
}

test.describe('CR-17 + CR-20', () => {
  test('the Unassigned board carries both senses; the mode filter narrows it to team-less cards', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const stamp = `${width} ${Date.now()}`;
    // A Platform card nobody holds, and a card with no team at all (D-147: both legacy states).
    const noAssignee = await apiCreate(page, {
      title: `CR17 no assignee ${stamp}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });
    await makeUnheld(noAssignee.key);
    const noTeam = await apiCreate(page, {
      title: `CR17 no team ${stamp}`,
      plane: 'org',
      state: 'in_prep',
    });
    await makeTeamless(noTeam.key); // CR-22: only legacy cards lack a team
    await makeUnheld(noTeam.key);

    // D-145: the page is no longer in the nav; it stays reachable for legacy team-less cards.
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Unassigned', exact: true })).toHaveCount(0);
    await page.goto('/unassigned');
    await expect(page.getByRole('heading', { level: 1, name: 'Unassigned backlog' })).toBeVisible();
    await expect(page.getByTestId(`card-${noAssignee.key}`)).toBeVisible();
    await expect(page.getByTestId(`card-${noTeam.key}`)).toBeVisible();
    // CR-23: Claim takes an unheld card of my team; a team-less card gets its team on the card page.
    await expect(page.getByTestId(`claim-${noAssignee.key}`)).toBeVisible();
    await expect(page.getByTestId(`claim-${noTeam.key}`)).toHaveCount(0);
    await shot('unassigned-all');
    await axe('unassigned-all');

    await page.getByTestId('filter-mode').selectOption('no_team');
    await expect(page.getByTestId(`card-${noTeam.key}`)).toBeVisible();
    await expect(page.getByTestId(`card-${noAssignee.key}`)).toHaveCount(0);
    await shot('unassigned-no-team');
  });

  test('clearing the assignee on a card sends it back to the team Backlog', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const card = await apiCreate(page, {
      title: `CR17 in flight ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      assigneeId: fixtureId('M1'),
      state: 'in_development',
    });
    await page.goto(`/cards/${card.key}`);
    await expect(page.getByTestId('detail-assignee')).toHaveValue(fixtureId('M1'));
    await page.getByTestId('detail-assignee').selectOption('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('flash')).toBeVisible(); // D-133: saved and closed
    await page.goto(`/cards/${card.key}`);
    await expect(page.getByTestId('detail-state')).toHaveValue('backlog');
    await shot('released-to-backlog');
  });

  test('D-143/D-150: a board card shows its assignee - initials when they have no picture - and an unassigned card shows nobody', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const stamp = `${width} ${Date.now()}`;
    const held = await apiCreate(page, {
      title: `D143 held ${stamp}`,
      plane: 'org',
      teamId: PLATFORM,
      assigneeId: fixtureId('M1'),
      state: 'in_prep',
    });
    const open = await apiCreate(page, {
      title: `D143 open ${stamp}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });
    await makeUnheld(open.key);
    await page.goto(`/teams/${PLATFORM}`);
    const heldCard = page.getByTestId(`card-${held.key}`);
    const openCard = page.getByTestId(`card-${open.key}`);
    // M1 has no picture: the name in small type, the full name in the tooltip.
    const assignee = heldCard.getByTestId('card-assignee');
    await expect(assignee.getByTestId('avatar-initials')).toHaveText('MM');
    await expect(assignee).toHaveAttribute('title', /Meera Member/);
    await expect(assignee).toHaveAccessibleName(/Meera Member/);
    // Nothing on the card face spills out of it, however narrow the column.
    const cardBox = await heldCard.boundingBox();
    const nameBox = await assignee.boundingBox();
    expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    // Nobody holds it, so nobody shows - not the person who raised it.
    await expect(openCard).toBeVisible();
    await expect(openCard.getByTestId('card-assignee')).toHaveCount(0);
    await expect(openCard.getByTestId('avatar-initials')).toHaveCount(0);
    await expect(openCard.getByTestId('avatar-img')).toHaveCount(0);
    await shot('card-face-person');
  });
});

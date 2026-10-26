// D-157 at desktop / tablet / mobile: the Teams page of the user's mockup - search, All / My
// teams, sort, "Create team" (admins), "Add member" (admins and the team's leads), "Open board"
// for members and admins only, and the row menu.
import { expect, test } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const PLATFORM = fixtureId('TEAM_PLATFORM');
const WEB = fixtureId('TEAM_WEB');

test.describe('D-157 teams look', () => {
  test('admin: search, create a team, add a member, row menu', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'ADMIN');
    const width = page.viewportSize()?.width ?? 0;
    const name = `Squad ${width} ${Date.now()}`;
    await page.goto('/teams');
    await expect(page.getByTestId('teams-tab-all')).toHaveAttribute('aria-selected', 'true');
    await shot('teams-look');
    await axe('teams-look');

    // Create a team here.
    await page.getByTestId('create-team-open').click();
    await page.getByTestId('create-team-name').fill(name);
    await page.getByTestId('create-team-description').fill('Made from the Teams page');
    await page.getByTestId('create-team-submit').click();
    await expect(page.getByTestId('create-team-dialog')).toHaveCount(0);

    // Search finds it; add Mohan to it.
    await page.getByTestId('teams-search').fill(name);
    const row = page.locator('[data-testid^="team-"]').filter({ hasText: name }).first();
    await expect(row).toContainText('Made from the Teams page');
    await expect(row).toContainText('0 members');
    const id = ((await row.getAttribute('data-testid')) ?? '').replace('team-', '');
    await page.getByTestId(`team-add-${id}`).locator('summary').click();
    await page.getByTestId(`team-add-select-${id}`).selectOption(fixtureId('M2'));
    await page.getByTestId(`team-add-submit-${id}`).click();
    await expect(row).toContainText('1 member');
    await expect(page.getByTestId(`team-members-${id}`)).toContainText('Mohan Member');

    // The row menu offers the board, its backlog, Team time and member management.
    await page.getByTestId(`team-menu-${id}`).locator('summary').click();
    await expect(page.getByTestId(`team-menu-${id}`).getByRole('link')).toHaveCount(4);
    await page.getByTestId(`team-menu-${id}`).getByRole('link', { name: 'Open backlog' }).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${id}/backlog$`));
  });

  test('member: no Create team, My teams tab, Open board only on their own team', async ({
    page,
  }) => {
    await signInViaApi(page, 'M1');
    await page.goto('/teams');
    await expect(page.getByTestId('create-team-open')).toHaveCount(0);
    await expect(page.getByTestId(`team-open-${PLATFORM}`)).toBeVisible();
    await expect(page.getByTestId(`team-${WEB}`).getByRole('link')).toHaveCount(0);
    await expect(page.getByTestId(`team-${WEB}`)).toContainText('Not your team');
    await expect(page.getByTestId(`team-add-${PLATFORM}`)).toHaveCount(0); // not a lead
    await page.getByTestId('teams-tab-mine').click();
    await expect(page.getByTestId(`team-${PLATFORM}`)).toBeVisible();
    await expect(page.getByTestId(`team-${WEB}`)).toHaveCount(0);
    await page.getByTestId('teams-sort').selectOption('nameDesc');
    await page.getByTestId(`team-open-${PLATFORM}`).click();
    await expect(page).toHaveURL(new RegExp(`/teams/${PLATFORM}$`));
  });
});

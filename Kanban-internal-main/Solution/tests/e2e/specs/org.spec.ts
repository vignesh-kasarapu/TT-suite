// S2 org plane at desktop / tablet / mobile: team + Unassigned boards with claim (FR-051/052/018),
// org card fields, links tab (FR-030..032), plane copy dialog (FR-017/019, D-056), programs /
// project pages with tree (FR-033), search (FR-056), admin teams / projects / members (FR-020..022, D-050).
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';
import { makeTeamless, makeUnheld } from './_fixtures/legacy';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');
const WEB = fixtureId('TEAM_WEB');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string; version: number; id: string };
}

test.describe('S2 org plane', () => {
  test('team board: org card created in the team; Unassigned board shows team-less cards; Claim moves one into my team', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    await page.goto(`/teams/${PLATFORM}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Platform board' })).toBeVisible();
    const title = `Team card ${width} ${Date.now()}`;
    await page.getByTestId('column-add-in_prep').click();
    await page.getByTestId('new-card-title').fill(title);
    await page.getByTestId('new-card-submit').click();
    await expect(page.getByTestId('card-title')).toHaveText(title);
    await expect(page).toHaveURL(new RegExp(`/teams/${PLATFORM}/cards/K-\\d+$`));
    // Org fields are present and pre-set to the team.
    await expect(page.getByTestId('detail-team')).toHaveValue(PLATFORM);
    await expect(page.getByTestId('detail-project')).toBeVisible();
    await expect(page.getByTestId('detail-assignee')).toBeVisible();
    await page.getByTestId('card-close').click();
    await expect(page).toHaveURL(new RegExp(`/teams/${PLATFORM}$`));
    await expect(page.getByTestId('column-in_prep').getByText(title)).toBeVisible();
    await shot('team-board');
    await axe('team-board');

    // Unassigned: a Platform card nobody holds appears; Claim (CR-23 = PATCH assigneeId = me)
    // takes it, so it leaves the Unassigned board for my Org tab.
    const loose = await apiCreate(page, {
      title: `Loose ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });
    await makeUnheld(loose.key); // D-147: a new card is always held; this one predates that
    await page.goto('/unassigned');
    await expect(page.getByRole('heading', { level: 1, name: 'Unassigned backlog' })).toBeVisible();
    await expect(page.getByTestId(`card-${loose.key}`)).toBeVisible();
    await page.getByTestId(`claim-${loose.key}`).click();
    await expect(page.getByTestId(`card-${loose.key}`)).toHaveCount(0);
    await page.goto('/org');
    await expect(page.getByTestId(`card-${loose.key}`)).toBeVisible();
    await shot('unassigned-claimed');
  });

  test('My board tabs (D-059, D-130): Private at /, Org (my teams) at /org; cards of my teams show there, only mine move', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const mine = await apiCreate(page, {
      title: `Assigned to me ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      assigneeId: fixtureId('M1'),
      state: 'in_prep',
    });
    // D-130: a Platform card someone else holds, one nobody holds, and another team's card.
    await signInViaApi(page, 'ADMIN');
    const held = await apiCreate(page, {
      title: `Held by admin ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      assigneeId: fixtureId('ADMIN'),
      state: 'in_prep',
    });
    const open = await apiCreate(page, {
      title: `Up for grabs ${width} ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
      state: 'in_prep',
    });
    await makeUnheld(open.key); // D-147: as above
    const web = await apiCreate(page, {
      title: `Web only ${width} ${Date.now()}`,
      plane: 'org',
      teamId: WEB,
      assigneeId: fixtureId('ADMIN'),
      state: 'in_prep',
    });
    await signInViaApi(page, 'M1');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'My board' })).toBeVisible();
    await expect(page.getByTestId(`card-${mine.key}`)).toHaveCount(0);
    await page.getByTestId('plane-switch').getByRole('link', { name: 'Org (my teams)' }).click();
    await expect(page).toHaveURL(/\/org$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My board' })).toBeVisible();
    // On the phone layout one column shows at a time; In Prep is where all of these start.
    if (width < 640) await page.getByTestId('column-switcher').selectOption('in_prep');
    await expect(page.getByTestId(`card-${mine.key}`)).toBeVisible();
    await expect(page.getByTestId(`move-${mine.key}`)).toBeEnabled();
    await expect(page.getByTestId(`card-${held.key}`)).toBeVisible();
    await expect(page.getByTestId(`move-${held.key}`)).toBeDisabled();
    await expect(page.getByTestId(`card-${open.key}`)).toBeVisible();
    await expect(page.getByTestId(`claim-${open.key}`)).toBeVisible();
    await expect(page.getByTestId(`card-${web.key}`)).toHaveCount(0);
    await page.getByTestId(`card-${mine.key}`).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/org/cards/${mine.key}$`));
    await page.getByTestId('card-close').click();
    await expect(page).toHaveURL(/\/org$/);
    await shot('my-board-org-tab');
  });

  test('admin (D-060) can edit a team card without being a member; a private card of someone else stays 404', async ({
    page,
    browser,
  }) => {
    await signInViaApi(page, 'M1');
    const teamCard = await apiCreate(page, {
      title: `Team card ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
    });
    const priv = await apiCreate(page, { title: `Private ${Date.now()}` });
    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p2 = await other.newPage();
    await signInViaApi(p2, 'ADMIN');
    await p2.goto(`/cards/${teamCard.key}`);
    await expect(p2.getByTestId('card-read-only')).toHaveCount(0);
    await p2.getByTestId('detail-title').fill(`${teamCard.key} edited by admin`);
    await p2.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(p2.getByTestId('flash')).toBeVisible(); // D-133: saved and closed
    await p2.goto(`/cards/${priv.key}`);
    await expect(p2.getByText(`Card ${priv.key} does not exist or is not yours.`)).toBeVisible();
    await other.close();
  });

  test('profile (D-064c): change display name and upload a picture on Preferences; the top bar shows both', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M2');
    const width = page.viewportSize()?.width ?? 0;
    await page.goto('/preferences');
    await page.getByTestId('profile-name').fill(`Mohan ${width}`);
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('who')).toContainText(`Mohan ${width}`);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await page
      .getByTestId('profile-photo')
      .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByTestId('who').getByTestId('avatar-img')).toBeVisible();
    await shot('profile');
    await page.getByTestId('profile-photo-remove').click();
    await expect(page.getByTestId('who').getByTestId('avatar-initials')).toBeVisible();
    await page.getByTestId('profile-name').fill('Mohan Member');
    await page.getByTestId('profile-save').click();
    await expect(page.getByTestId('who')).toContainText('Mohan Member');
  });

  test('links tab: add a blocks link, it shows on both cards with active/cleared; a non-member cannot open it and sees other teams unlinked (CR-14), with the team named (CR-28)', async ({
    page,
    browser,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const a = await apiCreate(page, {
      title: `Blocker ${Date.now()}`,
      plane: 'org',
      teamId: PLATFORM,
    });
    const b = await apiCreate(page, { title: `Blocked ${Date.now()}`, plane: 'org' });
    await makeTeamless(b.key); // readable by M2 too, so its History can point at the Platform card
    await page.goto(`/cards/${a.key}`);
    await page.getByTestId('tab-links').click();
    await page.getByTestId('link-type').selectOption('blocks');
    await page.getByTestId('link-target').fill(b.key.toLowerCase());
    await page.getByRole('button', { name: 'Add link' }).click();
    await expect(page.getByTestId('link')).toHaveCount(1);
    await expect(page.getByTestId('link')).toContainText('blocks');
    await expect(page.getByTestId('link')).toContainText('blocking');
    await shot('links');
    // Close the blocker -> the other card shows the block as cleared.
    await page.getByTestId('tab-details').click();
    await page.getByTestId('detail-state').selectOption('delivered');
    await expect(page.getByText('Version 3')).toBeVisible();
    await page.goto(`/cards/${b.key}`);
    await page.getByTestId('tab-links').click();
    await expect(page.getByTestId('link')).toContainText('blocked by');
    await expect(page.getByTestId('link')).toContainText('cleared');

    // CR-14: M2 (Web) cannot open the Platform card at all, and its Teams page lists Platform
    // without a link to the board; M2's own team stays a link.
    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p2 = await other.newPage();
    await signInViaApi(p2, 'M2');
    const limited = 'Access limited as the card belongs to another team - Platform.';
    await p2.goto(`/cards/${a.key}`);
    await expect(p2.getByText(limited)).toBeVisible();
    await shot('other-team-card');
    // CR-28: the team-less card's History names the team of the card it is blocked by.
    await p2.goto(`/cards/${b.key}`);
    await p2.getByTestId('tab-history').click();
    await expect(p2.getByTestId('event-other-team').first()).toHaveText(limited);
    await p2.goto(`/teams/${PLATFORM}`);
    await expect(
      p2.getByText('Access limited as the board belongs to another team - Platform.'),
    ).toBeVisible();
    await p2.goto('/teams');
    await expect(p2.getByTestId(`team-${PLATFORM}`).getByRole('link')).toHaveCount(0);
    await expect(p2.getByTestId(`team-${PLATFORM}`)).toContainText('Platform');
    // D-157: a member's row opens the board ("Open board"; the name links there too).
    await expect(
      p2.getByTestId(`team-${WEB}`).getByRole('link', { name: /Open board/ }),
    ).toBeVisible();
    await other.close();
  });

  test('copy dialog: promote a private card with one comment kept and one dropped; the org card is linked and visible to others', async ({
    page,
    browser,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const src = await apiCreate(page, { title: `Draft ${width} ${Date.now()}`, tags: ['idea'] });
    for (const body of ['keep this', 'drop this']) {
      const res = await page.request.post(`/api/v1/cards/${src.key}/comments`, {
        headers: CSRF,
        data: { body },
      });
      expect(res.status()).toBe(201);
    }
    await page.goto(`/cards/${src.key}`);
    await page.getByTestId('card-copy').click();
    const dialog = page.getByTestId('copy-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('copy-comment')).toHaveCount(2);
    await dialog.getByTestId('copy-comment').nth(1).uncheck();
    await dialog.getByTestId('copy-team').selectOption(PLATFORM);
    await dialog.getByTestId('copy-title-input').fill(`Shared ${width} ${Date.now()}`);
    await shot('copy-dialog');
    await axe('copy-dialog');
    await dialog.getByTestId('copy-submit').click();
    await expect(page).not.toHaveURL(new RegExp(`/cards/${src.key}$`));
    await expect(page).toHaveURL(/\/cards\/K-\d+$/);
    const copyKey = page.url().split('/cards/')[1] as string;
    await expect(page.getByTestId('card-title')).toContainText('Shared');
    await page.getByTestId('tab-comments').click();
    await expect(page.getByTestId('comment')).toHaveCount(1);
    await expect(page.getByTestId('comment')).toContainText('keep this');
    await expect(page.getByTestId('comment')).toContainText(`copied from ${src.key}`);
    await page.getByTestId('tab-links').click();
    await expect(page.getByTestId('link')).toContainText(src.key);

    const other = await browser.newContext({ viewport: page.viewportSize() });
    const p2 = await other.newPage();
    await signInViaApi(p2, 'ADMIN'); // M2 is outside Platform (CR-14); an admin reads every org card
    await p2.goto(`/cards/${copyKey}`);
    await expect(p2.getByTestId('card-title')).toContainText('Shared');
    await p2.goto(`/cards/${src.key}`);
    await expect(p2.getByText(`Card ${src.key} does not exist or is not yours.`)).toBeVisible();
    await other.close();
  });

  test('admin: create a team, add a member, remove them with a reassignment; create a project; programs page and tree; search', async ({
    page,
    browser,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'ADMIN');
    const width = page.viewportSize()?.width ?? 0;
    const stamp = `${width}-${Date.now()}`;
    // Users tab (D-083): the admin's own row has no toggles; invite a person with one team ->
    // Invited pill + re-send; the picker-only list on a board never shows them until they sign in.
    await page.goto('/admin/users');
    await expect(page.getByTestId(`user-${fixtureId('ADMIN')}`)).toBeVisible();
    await expect(page.getByTestId(`role-toggle-${fixtureId('ADMIN')}`)).toHaveCount(0);
    await expect(page.getByTestId(`role-toggle-${fixtureId('M1')}`)).toBeVisible();
    await page.getByTestId('invite-name').fill(`Invitee ${stamp}`);
    await page.getByTestId('invite-email').fill(`invitee-${stamp}@example.test`);
    await page.getByTestId(`invite-team-${PLATFORM}`).click();
    await page.getByTestId('invite-submit').click();
    await expect(page.getByText('Invitation queued.')).toBeVisible();
    const invitee = page.getByTestId('admin-users').locator('li', { hasText: `Invitee ${stamp}` });
    await expect(invitee.getByText('Invited')).toBeVisible();
    await expect(invitee.getByRole('button', { name: 'Re-send invitation' })).toBeVisible();
    await shot('admin-users');
    // Team + members.
    await page.goto('/admin');
    // Let the page's own GET /teams finish first: with ~100 teams from earlier runs in the Compose
    // database it takes long enough that a create landing mid-flight is answered by the stale list.
    await page.waitForLoadState('networkidle');
    await page.getByTestId('team-name').fill(`Ops ${stamp}`);
    await page.getByRole('button', { name: 'Add team' }).click();
    const teamLink = page.getByRole('link', { name: `Ops ${stamp}` });
    await expect(teamLink).toBeVisible();
    await teamLink.click();
    for (const code of ['M1', 'M2']) {
      await page.getByTestId('add-member-select').selectOption(fixtureId(code));
      await page.getByTestId('add-member').click();
      await expect(page.getByTestId(`member-${fixtureId(code)}`)).toBeVisible();
    }
    const teamId = page.url().split('/admin/teams/')[1] as string;
    // M1 holds an open card in the new team; removal reassigns it to M2 (D-050).
    const m1Ctx = await browser.newContext({ viewport: page.viewportSize() });
    const m1Page = await m1Ctx.newPage();
    await signInViaApi(m1Page, 'M1');
    const held = await apiCreate(m1Page, {
      title: `Held ${stamp}`,
      plane: 'org',
      teamId,
      assigneeId: fixtureId('M1'),
    });
    await m1Ctx.close();
    await page
      .getByTestId(`member-${fixtureId('M1')}`)
      .getByTestId('member-remove')
      .click();
    const dialog = page.getByTestId('remove-member');
    await expect(dialog.getByTestId(`reassign-${held.key}`)).toBeVisible();
    await dialog.getByTestId(`reassign-select-${held.key}`).selectOption(fixtureId('M2'));
    await shot('remove-member');
    await axe('remove-member');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId(`member-${fixtureId('M1')}`)).toHaveCount(0);
    const cardRes = await page.request.get(`/api/v1/cards/${held.key}`);
    expect(((await cardRes.json()) as { assigneeId: string }).assigneeId).toBe(fixtureId('M2'));

    // Project in Web, shown on the programs page and its tree.
    await page.goto('/admin/projects');
    await page.getByTestId('project-name').fill(`Proj ${stamp}`);
    await page.getByTestId('project-team').selectOption(WEB);
    await page.getByTestId('project-target').fill('2026-12-31');
    await page.getByTestId('project-submit').click();
    const projLink = page.getByRole('link', { name: `Proj ${stamp}` });
    await expect(projLink).toBeVisible();
    await page.goto('/programs');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Programs & projects' }),
    ).toBeVisible();
    await page.getByRole('link', { name: `Proj ${stamp}` }).click();
    await expect(page.getByTestId('project-page')).toBeVisible();
    await expect(page.getByTestId('tree')).toBeVisible();
    await shot('project-page');

    // Tags vocabulary (D-062): add one, it appears in the card picker for a member.
    await page.goto('/admin/tags');
    const tagName = `t${stamp}`.replace(/-/g, '');
    await page.getByTestId('tag-name').fill(tagName);
    await page.getByTestId('tag-add').click();
    await expect(page.getByTestId(`admin-tag-${tagName}`)).toBeVisible();
    const m2Ctx = await browser.newContext({ viewport: page.viewportSize() });
    const m2Page = await m2Ctx.newPage();
    await signInViaApi(m2Page, 'M2');
    await m2Page.goto(`/cards/${held.key}`);
    await m2Page.getByTestId('detail-tags').getByTestId(`tag-${tagName}`).click();
    await m2Page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(m2Page.getByTestId('flash')).toBeVisible();
    await m2Ctx.close();

    // Search finds the held card by key, and by filters alone (D-063).
    await page.goto('/search');
    await page.getByTestId('search-input').fill(held.key);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByTestId(`hit-${held.key}`)).toBeVisible();
    await page.goto('/search');
    // Phones (< 640 px) fold the filters behind a button.
    if ((page.viewportSize()?.width ?? 0) < 640)
      await page.getByTestId('search-filters-toggle').click();
    await page.getByTestId('search-tag').selectOption(tagName);
    await expect(page.getByTestId(`hit-${held.key}`)).toBeVisible();
    await page.getByTestId('search-state').selectOption('delivered');
    await expect(page.getByTestId(`hit-${held.key}`)).toHaveCount(0);
    await shot('search');
    await axe('search');
  });
  test('CR-11: an admin makes a member a lead; the lead administers that team and nothing else', async ({
    page,
    browser,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'ADMIN');
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    // 'Z' keeps this temporary team out of `me.teams[0]`, which the Claim control uses, while
    // the viewport projects run in parallel against one database; M2 never claims.
    const name = `Zlead ${stamp}`;
    await page.goto('/admin');
    await page.getByTestId('team-name').fill(name);
    await page.getByRole('button', { name: 'Add team' }).click();
    await page.getByRole('link', { name }).click();
    const teamId = page.url().split('/admin/teams/')[1] as string;
    await page.getByTestId('add-member-select').selectOption(fixtureId('M2'));
    await page.getByTestId('add-member').click();
    const row = page.getByTestId(`member-${fixtureId('M2')}`);
    await expect(row).toBeVisible();
    await row.getByTestId('member-lead').click();
    await expect(row.getByText('Lead', { exact: true })).toBeVisible();

    // The lead's own session: Administration appears, with Teams and Projects only.
    const ctx = await browser.newContext({ viewport: page.viewportSize() });
    const lead = await ctx.newPage();
    await signInViaApi(lead, 'M2');
    await lead.goto('/admin');
    await expect(lead.getByTestId('admin-teams')).toBeVisible();
    await expect(lead.getByRole('link', { name })).toBeVisible();
    await expect(lead.getByRole('link', { name: 'Web' })).toHaveCount(0);
    await expect(lead.getByTestId('team-name')).toHaveCount(0);
    await expect(lead.getByRole('link', { name: 'Users' })).toHaveCount(0);
    await expect(lead.getByRole('link', { name: 'Tags' })).toHaveCount(0);
    await shot('lead-admin');
    await axe('lead-admin');
    // They may rename their own team, and a project of it.
    await lead.goto(`/admin/teams/${teamId}`);
    await lead.getByTestId('team-edit-name').fill(`${name} v2`);
    await lead.getByTestId('team-form').getByRole('button', { name: 'Save' }).click();
    await expect(lead.getByRole('heading', { level: 2, name: `${name} v2` })).toBeVisible();
    await lead.goto('/admin/projects');
    await lead.getByTestId('project-name').fill(`Leadproj ${stamp}`);
    await lead.getByTestId('project-team').selectOption(teamId);
    await lead.getByTestId('project-submit').click();
    await expect(lead.getByRole('link', { name: `Leadproj ${stamp}` })).toBeVisible();
    // The admin-only tabs are refused even when typed in.
    await lead.goto('/admin/users');
    await expect(lead.getByTestId('permission-denied')).toBeVisible();
    await ctx.close();

    // Clean up so the shared database keeps its fixture shape for the other specs.
    const projects = (await (
      await page.request.get(`/api/v1/projects?teamId=${teamId}`)
    ).json()) as { items: { id: string }[] };
    for (const pr of projects.items)
      await page.request.delete(`/api/v1/projects/${pr.id}`, { headers: CSRF });
    await page.request.post(`/api/v1/teams/${teamId}/members/${fixtureId('M1')}/removal`, {
      headers: CSRF,
      data: {},
    });
    await page.request.delete(`/api/v1/teams/${teamId}`, { headers: CSRF });
  });
  test('CR-12: an admin stops intake on a project, then closes it through the open-card checklist', async ({
    page,
    shot,
    axe,
  }) => {
    await signInViaApi(page, 'ADMIN');
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    const name = `Zretire ${stamp}`;
    await page.goto('/admin/projects');
    await page.getByTestId('project-name').fill(name);
    await page.getByTestId('project-team').selectOption(PLATFORM);
    await page.getByTestId('project-submit').click();
    await expect(page.getByRole('link', { name })).toBeVisible();
    const list = (await (await page.request.get(`/api/v1/projects?teamId=${PLATFORM}`)).json()) as {
      items: { id: string; name: string }[];
    };
    const projectId = list.items.find((pr) => pr.name === name)?.id as string;
    const card = await apiCreate(page, {
      title: `Retire me ${stamp}`,
      plane: 'org',
      state: 'in_prep',
      teamId: PLATFORM,
      projectId,
    });

    // Stop intake: the X on the row. The project stays on the board filter, but the
    // new-card dialog will not offer it any more.
    await page.getByTestId(`project-intake-${projectId}`).click();
    await expect(
      page.getByTestId(`project-intake-${projectId}`).and(page.locator('[aria-pressed="true"]')),
    ).toBeVisible();
    await shot('project-intake-stopped');
    await page.goto(`/teams/${PLATFORM}`);
    await page.getByTestId('column-add-in_prep').click();
    await expect(
      page.getByTestId('new-card-project').locator(`option[value="${projectId}"]`),
    ).toHaveCount(0);
    await page.getByTestId('new-card-dialog').getByRole('button', { name: 'Cancel' }).click();

    // Closing refuses while the card is open, then goes through once it is ticked.
    await page.goto('/admin/projects');
    await page.getByTestId(`admin-project-${projectId}`).getByTestId('project-close').click();
    await expect(page.getByTestId('close-project')).toBeVisible();
    await expect(page.getByTestId(`close-card-${card.key}`)).toBeVisible();
    await page.getByTestId('close-comment').fill('Retired at the end of the trial.');
    await page.getByTestId(`close-tick-${card.key}`).check();
    await shot('project-closure-dialog');
    await axe('project-closure-dialog');
    await page.getByTestId('close-project').getByRole('button', { name: 'Close' }).click();

    // Gone from the list until asked for; the card is Cancelled and carries the comment.
    await expect(page.getByTestId(`admin-project-${projectId}`)).toHaveCount(0);
    await page.getByTestId('project-include-closed').check();
    await expect(page.getByTestId(`admin-project-${projectId}`)).toBeVisible();
    await page.goto(`/teams/${PLATFORM}/cards/${card.key}`);
    await expect(page.getByTestId('detail-state')).toHaveValue('cancelled');
    await page.getByTestId('tab-comments').click();
    await expect(page.getByText('Retired at the end of the trial.')).toBeVisible();

    // Reopen in one action, then clean up the shared database.
    await page.goto('/admin/projects');
    await page.getByTestId('project-include-closed').check();
    await page.getByTestId(`admin-project-${projectId}`).getByTestId('project-reopen').click();
    await page.getByTestId('reopen-project').getByRole('button', { name: 'Reopen' }).click();
    await expect(page.getByTestId(`admin-project-${projectId}`)).toBeVisible();
    await page.request.patch(`/api/v1/cards/${card.key}`, {
      headers: CSRF,
      data: { version: card.version + 1, projectId: null },
    });
    await page.request.delete(`/api/v1/projects/${projectId}`, { headers: CSRF });
  });
});

// Team walkthrough (on request, not part of ci:local): on an EMPTY database whose only person is
// the boot admin, build a small company through the UI and use every feature as each person.
//
//   Anita Rao (admin)
//   Payments          - lead Karthik Menon; members Divya Pillai, Rohan Gupta, Meera Joshi
//   Customer Portal   - lead Farah Khan;    members Vivek Iyer, Lakshmi Narayan, Sameer Patel
//
// Run: npm run e2e:walkthrough (see walkthrough.config.ts). Steps use soft checks so one bug does
// not hide the next; every failure is listed in the report.
import { expect, test, type Browser, type Page } from '@playwright/test';

const ADMIN_LOGIN = 'anita.rao'; // the boot admin's name until they rename themselves
const ADMIN = 'Anita Rao';
const TEAMS = {
  payments: {
    name: 'Payments',
    lead: 'Karthik Menon',
    members: ['Divya Pillai', 'Rohan Gupta', 'Meera Joshi'],
  },
  portal: {
    name: 'Customer Portal',
    lead: 'Farah Khan',
    members: ['Vivek Iyer', 'Lakshmi Narayan', 'Sameer Patel'],
  },
} as const;
const emailOf = (name: string) => `${name.toLowerCase().replace(/ /g, '.')}@example.test`;
const XHR = { 'X-Requested-With': 'XHR' };

type Ids = { teams: Record<string, string>; users: Record<string, string> };
const ids: Ids = { teams: {}, users: {} };
const cards: Record<string, string> = {};

async function as(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/sign-in');
  const option = page.locator('[data-testid=sign-in-user] option', { hasText: `${name} (` });
  const value = await option.getAttribute('value');
  await page.getByTestId('sign-in-user').selectOption(value ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('nav')).toBeVisible();
  return page;
}

async function done(page: Page) {
  await page.context().close();
}

/** Create a card from a team board through the dialog; returns its key. */
async function newCard(
  page: Page,
  teamId: string,
  title: string,
  description: string,
  assignee = 'me', // D-127: 'me', '' (up for claiming) or a teammate's id
) {
  await page.goto(`/teams/${teamId}`);
  await page.getByTestId('column-add-in_prep').click();
  await page.getByTestId('new-card-title').fill(title);
  await page.getByTestId('new-card-description').fill(description);
  // The teammates arrive with the team; the lead's own name is never listed (they are "Me").
  if (assignee !== 'me' && assignee !== '')
    await expect(
      page.getByTestId('new-card-assignee').locator(`option[value="${assignee}"]`),
    ).toHaveCount(1);
  await page.getByTestId('new-card-assignee').selectOption(assignee);
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/cards') && r.request().method() === 'POST',
    ),
    page.getByTestId('new-card-submit').click(),
  ]);
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { key: string }).key;
}

test.describe.configure({ mode: 'serial' });

test.describe('Team walkthrough', () => {
  test('0. someone not invited messages the admin from the sign-in page', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByTestId('contact-open').click();
    await page.getByTestId('contact-name').fill('Neha Kapoor');
    await page.getByTestId('contact-email').fill('neha.kapoor@example.test');
    await page.getByTestId('contact-message').fill('I joined Payments today and need access.');
    await page.getByTestId('contact-send').click();
    await expect(page.getByTestId('contact-sent')).toBeVisible();
    const outbox = (await (await page.request.get('/api/v1/dev/notifications')).json()) as {
      items: { kind: string }[];
    };
    expect.soft(outbox.items.some((n) => n.kind === 'contact_admin')).toBe(true);
  });

  test('1. admin: profile, teams, people, leads, program, projects, tags', async ({ browser }) => {
    const page = await as(browser, ADMIN_LOGIN);
    await test.step('rename themselves', async () => {
      await page.goto('/preferences');
      await page.getByTestId('profile-name').fill(ADMIN);
      await page.getByTestId('profile-save').click();
      await expect.soft(page.getByText(ADMIN).first()).toBeVisible();
    });
    await test.step('two teams', async () => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
      for (const team of Object.values(TEAMS)) {
        await page.getByTestId('team-name').fill(team.name);
        await page.getByRole('button', { name: 'Add team' }).click();
        await expect(page.getByRole('link', { name: team.name, exact: true })).toBeVisible();
      }
      const list = (await (await page.request.get('/api/v1/teams')).json()) as {
        items: { id: string; name: string }[];
      };
      for (const tm of list.items) ids.teams[tm.name] = tm.id;
    });
    await test.step('invite eight people into their team', async () => {
      await page.goto('/admin/users');
      for (const team of Object.values(TEAMS))
        for (const person of [team.lead, ...team.members]) {
          await page.getByTestId('invite-name').fill(person);
          await page.getByTestId('invite-email').fill(emailOf(person));
          await page.getByTestId(`invite-team-${ids.teams[team.name]}`).click();
          await page.getByTestId('invite-submit').click();
          await expect(page.getByText('Invitation queued.')).toBeVisible();
          await expect(
            page.getByTestId('admin-users').locator('li', { hasText: person }),
          ).toBeVisible();
        }
      const users = (await (await page.request.get('/api/v1/users?status=all')).json()) as {
        items: { id: string; name: string }[];
      };
      for (const u of users.items) ids.users[u.name] = u.id;
    });
    await test.step('make the leads', async () => {
      for (const team of Object.values(TEAMS)) {
        await page.goto(`/admin/teams/${ids.teams[team.name]}`);
        const row = page.getByTestId(`member-${ids.users[team.lead]}`);
        await expect(row).toBeVisible();
        for (const m of team.members)
          await expect.soft(page.getByTestId(`member-${ids.users[m]}`)).toBeVisible();
        await row.getByTestId('member-lead').click();
        await expect.soft(row.getByText('Lead', { exact: true })).toBeVisible();
      }
    });
    await test.step('program, two projects attached, tags', async () => {
      await page.goto('/admin/projects');
      for (const [project, team] of [
        ['UPI Checkout', TEAMS.payments.name],
        ['Self-service Portal', TEAMS.portal.name],
      ] as const) {
        await page.getByTestId('project-name').fill(project);
        await page.getByTestId('project-team').selectOption(ids.teams[team] ?? '');
        await page.getByTestId('project-target').fill('2026-12-31');
        await page.getByTestId('project-submit').click();
        await expect(page.getByRole('link', { name: project })).toBeVisible();
      }
      await page.goto('/admin/programs');
      await page.getByTestId('program-name').fill('Retail Banking Revamp');
      await page.getByTestId('program-target').fill('2027-03-31');
      await page.getByTestId('program-submit').click();
      const program = page.locator('[data-testid^=admin-program-]', {
        hasText: 'Retail Banking Revamp',
      });
      await expect(program).toBeVisible();
      await program.getByTestId('program-edit').click();
      const projects = (await (await page.request.get('/api/v1/projects')).json()) as {
        items: { id: string; name: string }[];
      };
      for (const p of projects.items) {
        await page.getByTestId('project-attach-pick').selectOption(p.id);
        await page.getByTestId('project-attach').click();
        await expect.soft(page.getByTestId(`attached-${p.id}`)).toBeVisible();
      }
      await page.goto('/admin/tags');
      for (const tag of ['backend', 'frontend', 'bug']) {
        await page.getByTestId('tag-name').fill(tag);
        await page.getByTestId('tag-add').click();
        await expect.soft(page.getByTestId(`admin-tag-${tag}`)).toBeVisible();
      }
    });
    await done(page);
  });

  test('1b. someone invited who has not signed in yet is not offered as an assignee', async ({
    browser,
  }) => {
    // D-126 (was bug 1): only people who have signed in can hold a card, so the pickers leave the
    // invited ones out instead of offering a name the server then refuses.
    const lead = await as(browser, TEAMS.payments.lead);
    await lead.goto(`/teams/${ids.teams[TEAMS.payments.name]}`);
    await lead.getByTestId('column-add-in_prep').click();
    const picker = lead.getByTestId('new-card-assignee');
    await expect(picker.locator('option')).toHaveCount(1); // Me - nobody else yet (D-147: no Unassigned)
    await expect.soft(picker.locator(`option[value="${ids.users['Meera Joshi']}"]`)).toHaveCount(0);
    await done(lead);
  });

  test('1c. everyone signs in once (activates their invitation)', async ({ browser }) => {
    for (const team of Object.values(TEAMS))
      for (const person of [team.lead, ...team.members]) await done(await as(browser, person));
  });

  test('2. Payments lead plans the work and hands it out', async ({ browser }) => {
    const lead = await as(browser, TEAMS.payments.lead);
    const team = ids.teams[TEAMS.payments.name] ?? '';
    const plan: [string, string, string | null][] = [
      ['Integrate UPI collect API', 'Call the bank sandbox and handle callbacks.', 'Divya Pillai'],
      ['Refund flow for failed payments', 'Automatic refund within 24 h.', 'Rohan Gupta'],
      ['Payment receipt email', 'Send a receipt after a successful payment.', null],
    ];
    for (const [title, description, assignee] of plan) {
      // D-127: the assignee is picked in the dialog ('' = up for claiming).
      const key = await newCard(
        lead,
        team,
        title,
        description,
        assignee ? (ids.users[assignee] ?? '') : '',
      );
      cards[title] = key;
      await lead.goto(`/cards/${key}`);
      await expect
        .soft(lead.getByTestId('detail-assignee'))
        .toHaveValue(assignee ? (ids.users[assignee] ?? '') : '');
      await lead.getByTestId('detail-project').selectOption({ label: 'UPI Checkout' });
      await lead.getByTestId('detail-priority').selectOption('2');
      await lead.getByTestId('detail-tags').getByTestId('tag-backend').click();
      await lead.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.soft(lead.getByTestId('flash')).toBeVisible();
    }
    await test.step('the lead cannot see the other team', async () => {
      await lead.goto(`/teams/${ids.teams[TEAMS.portal.name]}`);
      await expect.soft(lead.getByText(/belongs to another team/)).toBeVisible();
    });
    await done(lead);
  });

  test('3. Customer Portal lead plans their work', async ({ browser }) => {
    const lead = await as(browser, TEAMS.portal.lead);
    const team = ids.teams[TEAMS.portal.name] ?? '';
    const key = await newCard(lead, team, 'Self-service password reset', 'Reset by OTP to email.');
    cards['Self-service password reset'] = key;
    await lead.goto(`/cards/${key}`);
    await lead.getByTestId('detail-project').selectOption({ label: 'Self-service Portal' });
    await lead.getByTestId('detail-assignee').selectOption(ids.users['Vivek Iyer'] ?? '');
    await lead.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.soft(lead.getByTestId('flash')).toBeVisible();
    await done(lead);
  });

  test('4. Divya works her card: moves it, comments, links, files, logs time', async ({
    browser,
  }) => {
    const divya = await as(browser, 'Divya Pillai');
    const key = cards['Integrate UPI collect API'] ?? '';
    const receipt = cards['Payment receipt email'] ?? '';
    await test.step('the bell shows the assignment', async () => {
      await expect.soft(divya.getByTestId('bell-count')).toBeVisible();
    });
    await test.step('move to In-Progress', async () => {
      await divya.goto(`/cards/${key}`);
      await divya.getByTestId('detail-state').selectOption('in_development');
      await expect.soft(divya.getByTestId('detail-state')).toHaveValue('in_development');
    });
    await test.step('comment', async () => {
      await divya.getByTestId('tab-comments').click();
      await divya.getByTestId('comment-body').fill('Sandbox keys received, starting today.');
      await divya.getByRole('button', { name: 'Add comment' }).click();
      await expect.soft(divya.getByTestId('comment')).toHaveCount(1);
    });
    await test.step('link: blocks the receipt card', async () => {
      await divya.getByTestId('tab-links').click();
      await divya.getByTestId('link-type').selectOption('blocks');
      await divya.getByTestId('link-target').fill(receipt);
      await divya.getByRole('button', { name: 'Add link' }).click();
      await expect.soft(divya.getByTestId('link')).toHaveCount(1);
    });
    await test.step('file link', async () => {
      await divya.getByTestId('tab-files').click();
      await divya.getByTestId('attachment-title').fill('UPI API spec');
      await divya.getByTestId('attachment-url').fill('https://sharepoint.example.test/upi-spec');
      await divya.getByTestId('attachment-add').click();
      await expect.soft(divya.getByTestId('attachment')).toHaveCount(1);
    });
    await test.step('log 3 h from My time', async () => {
      await divya.goto('/time');
      await divya.getByTestId('time-card').click();
      await divya.getByTestId('time-card-search').fill('UPI collect');
      await divya.getByTestId(`time-card-option-${key}`).click();
      await divya.getByTestId('time-log-hours').fill('3');
      await divya.getByTestId('time-log-note').fill('Sandbox integration');
      await divya.getByTestId('time-log-submit').click();
      await expect.soft(divya.getByText(`Logged 3 h on ${key}.`)).toBeVisible();
      await divya.getByTestId('note-add').click(); // D-154: the note opens from "Add note"
      await divya.getByTestId('week-note').fill('Mostly on UPI integration this week.');
      await divya.getByTestId('week-note-save').click();
      await expect.soft(divya.getByText('Note saved.')).toBeVisible();
    });
    await done(divya);
  });

  test('5. Rohan claims the unassigned card; Meera cannot move a card she is not on', async ({
    browser,
  }) => {
    const rohan = await as(browser, 'Rohan Gupta');
    const receipt = cards['Payment receipt email'] ?? '';
    // Made from the Board tab, the card starts in In Prep - on the board, not the backlog.
    await rohan.goto('/unassigned');
    await rohan.getByTestId(`claim-${receipt}`).click();
    await rohan.goto(`/cards/${receipt}`);
    await expect
      .soft(rohan.getByTestId('detail-assignee'))
      .toHaveValue(ids.users['Rohan Gupta'] ?? '');
    await rohan.getByTestId('detail-state').selectOption('ready');
    await expect.soft(rohan.getByTestId('detail-state')).toHaveValue('ready');
    await done(rohan);

    const meera = await as(browser, 'Meera Joshi');
    await meera.goto(`/cards/${cards['Integrate UPI collect API']}`);
    await expect.soft(meera.getByTestId('detail-state')).toBeDisabled();
    await meera.goto(`/cards/${cards['Self-service password reset']}`);
    await expect.soft(meera.getByText(/belongs to another team/)).toBeVisible();
    await done(meera);
  });

  test('6. leads review: Team time, search, reports', async ({ browser }) => {
    const lead = await as(browser, TEAMS.payments.lead);
    await lead.goto(`/team-time?team=${ids.teams[TEAMS.payments.name]}`);
    await expect.soft(lead.getByTestId('team-time')).toContainText('Divya Pillai');
    await expect.soft(lead.getByTestId('team-time')).toContainText('Meera Joshi');
    await lead.goto('/search');
    await lead.getByTestId('search-input').fill('refund');
    await lead.getByRole('button', { name: 'Search' }).click();
    await expect
      .soft(lead.getByTestId(`hit-${cards['Refund flow for failed payments']}`))
      .toBeVisible();
    await lead.goto('/reports');
    await expect.soft(lead.getByRole('heading', { level: 1 })).toBeVisible();
    await done(lead);

    const other = await as(browser, TEAMS.portal.lead);
    await other.goto(`/team-time?team=${ids.teams[TEAMS.payments.name]}`);
    await expect.soft(other.getByTestId('team-time')).not.toContainText('Divya Pillai');
    await done(other);
  });

  test('7. admin oversight: every card, the program page, the contact message', async ({
    browser,
  }) => {
    const admin = await as(browser, ADMIN);
    await admin.goto('/search');
    await admin.getByTestId('search-input').fill('payment');
    await admin.getByRole('button', { name: 'Search' }).click();
    await expect.soft(admin.getByTestId(`hit-${cards['Payment receipt email']}`)).toBeVisible();
    await admin.goto('/programs');
    await admin.getByRole('link', { name: 'Retail Banking Revamp' }).click();
    await expect.soft(admin.getByText('UPI Checkout').first()).toBeVisible();
    await expect.soft(admin.getByText('Self-service Portal').first()).toBeVisible();
    // Mail went out (the dev worker drains the outbox): invitations, assignments, the message.
    await admin.request.post('/api/v1/dev/notifications/run', { headers: XHR });
    const mail = (await (await admin.request.get('/api/v1/dev/mail')).json()) as {
      items: { to: string; subject: string }[];
    };
    const to = (email: string, subject: string) =>
      mail.items.some((m) => m.to === email && m.subject.includes(subject));
    expect.soft(to(emailOf(ADMIN), 'cannot sign in: Neha Kapoor')).toBe(true);
    expect.soft(to(emailOf('Divya Pillai'), 'You were assigned')).toBe(true);
    expect.soft(to(emailOf('Meera Joshi'), 'invited')).toBe(true);
    await done(admin);
  });
});

// CR-18 at desktop / tablet / mobile: every filter's empty value reads "All", dropdowns come before
// check-boxes in every filter bar, and no screen or dialog overlaps, spills or scrolls sideways.
// Each screen is shot per viewport as the sweep's evidence.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function api<T>(page: Page, method: 'post' | 'get', url: string, data?: unknown): Promise<T> {
  const res = await page.request[method](`/api/v1/${url}`, { headers: CSRF, data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

/** Layout faults on the current screen: sideways page scroll, overlapping controls inside one
 *  filter bar / form / open dialog, and text spilling out of a box too narrow for it. */
async function layoutFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > innerWidth + 1)
      faults.push(`page scrolls sideways ${de.scrollWidth}>${innerWidth}`);
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const label = (e: Element) =>
      (e as HTMLElement).dataset['testid'] ??
      `${e.tagName.toLowerCase()} "${((e as HTMLElement).innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
    // The topmost dialogs only: one opened from the card window (CR-25) sits inside it.
    const open = [...document.querySelectorAll('dialog[open]')].filter(
      (d) => !d.querySelector('dialog[open]'),
    );
    for (const d of open)
      if (d.scrollWidth > d.clientWidth + 2)
        faults.push(`dialog scrolls sideways ${d.scrollWidth}>${d.clientWidth}`);
    const scopes = open.length
      ? open
      : [...document.querySelectorAll('main [role="group"], main form')];
    for (const scope of scopes) {
      const controls = [...scope.querySelectorAll('input, select, button, textarea')].filter(shown);
      for (let i = 0; i < controls.length; i++)
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i]!.getBoundingClientRect();
          const b = controls[j]!.getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 3 && h > 3)
            faults.push(`overlap ${label(controls[i]!)} x ${label(controls[j]!)}`);
        }
    }
    const root = open.length ? open : [document.querySelector('main') ?? document.body];
    // D-087: a control squashed to a sliver (the tab strip once collapsed on tall pages).
    for (const r of root)
      for (const c of r.querySelectorAll(
        'button, select, [role="tab"], input:not([type="checkbox"]):not([type="radio"])',
      )) {
        const h = c.getBoundingClientRect().height;
        if (h > 0 && h < 16 && getComputedStyle(c).visibility !== 'hidden')
          faults.push(`squashed ${label(c)} ${Math.round(h)}px high`);
      }
    for (const r of root)
      for (const e of [r, ...r.querySelectorAll('*')]) {
        // Content cut off by a box that hides its overflow (an ellipsis is deliberate).
        const el = e as HTMLElement;
        const cs = getComputedStyle(el);
        if (
          shown(el) &&
          !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && // they scroll their own text
          el.clientWidth > 2 &&
          /hidden|clip/.test(cs.overflowX) &&
          cs.textOverflow !== 'ellipsis' &&
          el.scrollWidth > el.clientWidth + 2
        )
          faults.push(`clipped ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    for (const r of root)
      for (const e of r.querySelectorAll('*')) {
        if (
          e.children.length ||
          !shown(e) ||
          ['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(e.tagName)
        )
          continue;
        if (e.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
        const el = e as HTMLElement;
        if (
          el.clientWidth > 0 &&
          el.scrollWidth > el.clientWidth + 2 &&
          getComputedStyle(el).overflowX === 'visible'
        )
          faults.push(`spills ${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    return faults;
  });
}

/** In every filter bar: no "Any…" empty value, and no dropdown after a check-box. */
async function filterBarFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = [];
    for (const bar of document.querySelectorAll('main [role="group"]')) {
      let tickSeen = false;
      for (const el of bar.querySelectorAll('select, input[type="checkbox"]')) {
        if (el.tagName === 'SELECT') {
          const first = (el as HTMLSelectElement).options[0]?.text ?? '';
          if (/^any/i.test(first)) faults.push(`"${first}" should read All`);
          if (tickSeen) faults.push(`dropdown ${el.getAttribute('aria-label')} after a check-box`);
        } else tickSeen = true;
      }
    }
    return faults;
  });
}

async function sweep(page: Page, shot: (n: string) => Promise<void>, name: string) {
  await page.waitForLoadState('networkidle');
  expect(await layoutFaults(page), name).toEqual([]);
  expect(await filterBarFaults(page), name).toEqual([]);
  await shot(`sweep-${name}`);
}

test.describe('CR-18 layout sweep', () => {
  test('every screen and dialog: All, dropdowns before ticks, nothing overlapping or spilling', async ({
    page,
    shot,
  }) => {
    test.setTimeout(300_000);
    await signInViaApi(page, 'ADMIN');
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    // Realistic, awkward content: long names and titles, one unbroken word.
    const program = await api<{ id: string }>(page, 'post', 'programs', {
      name: `Customer Onboarding Modernisation Programme ${stamp}`,
    });
    const project = await api<{ id: string }>(page, 'post', 'projects', {
      name: `Self-service sign-up and identity verification portal ${stamp}`,
      teamId: PLATFORM,
      programId: program.id,
    });
    const titles = [
      'Migrate the legacy onboarding wizard to the new component library and remove the jQuery dependency',
      'Supercalifragilisticexpialidociouslylongunbrokenwordtitle_without_spaces_to_test_wrapping',
      'Fix login',
    ];
    const cards: { key: string }[] = [];
    for (const title of titles)
      cards.push(
        await api(page, 'post', 'cards', {
          title: `${title} ${stamp}`,
          plane: 'org',
          teamId: PLATFORM,
          projectId: project.id,
          state: 'in_prep',
          tags: [],
        }),
      );
    const key = cards[0]!.key;
    await api(page, 'post', `cards/${key}/comments`, {
      body: 'A fairly long comment to check how threads wrap on a narrow screen. '.repeat(3),
    });

    const screens: [string, string][] = [
      ['my-board', '/'],
      ['my-board-org', '/org'],
      ['team-board', `/teams/${PLATFORM}`],
      ['team-backlog', `/teams/${PLATFORM}/backlog`],
      ['unassigned', '/unassigned'],
      ['unassigned-backlog', '/unassigned/backlog'],
      ['my-backlog', '/backlog'],
      ['my-board-org-backlog', '/org/backlog'],
      ['permission-denied', '/permission-denied'],
      ['inbox', '/inbox'],
      ['search', '/search?q=onboarding'],
      ['reports', '/reports'],
      ['preferences', '/preferences'],
      ['teams', '/teams'],
      ['programs', '/programs'],
      ['program', `/programs/${program.id}`],
      ['project', `/projects/${project.id}`],
      ['admin-teams', '/admin'],
      ['admin-team', `/admin/teams/${PLATFORM}`],
      ['admin-programs', '/admin/programs'],
      ['admin-projects', '/admin/projects'],
      ['admin-tags', '/admin/tags'],
      ['admin-users', '/admin/users'],
    ];
    for (const [name, url] of screens) {
      await page.goto(url);
      await expect(page.locator('main h1').first()).toBeVisible();
      await sweep(page, shot, name);
    }

    // The card: a side panel from 640, its own page below - opened from every board it hangs off.
    const mine = await api<{ key: string }>(page, 'post', 'cards', {
      title: `Private ${stamp}`,
      plane: 'private',
    });
    const cardUrls: [string, string][] = [
      ['card', `/teams/${PLATFORM}/cards/${key}`],
      ['card-team-backlog', `/teams/${PLATFORM}/backlog/cards/${key}`],
      ['card-org', `/org/cards/${key}`],
      ['card-org-backlog', `/org/backlog/cards/${key}`],
      ['card-unassigned', `/unassigned/cards/${key}`],
      ['card-unassigned-backlog', `/unassigned/backlog/cards/${key}`],
      ['card-private', `/cards/${mine.key}`],
      ['card-private-backlog', `/backlog/cards/${mine.key}`],
    ];
    for (const [name, url] of cardUrls) {
      await page.goto(url);
      await expect(page.getByTestId('card-copy')).toBeVisible();
      await sweep(page, shot, name);
    }

    // Dialogs.
    await page.goto(`/teams/${PLATFORM}`);
    await page.getByTestId('column-add-in_prep').click();
    await expect(page.getByTestId('new-card-dialog')).toBeVisible();
    await sweep(page, shot, 'dialog-new-card');
    await page.keyboard.press('Escape');

    await page.goto(`/cards/${key}`);
    await page.getByTestId('card-copy').click();
    await expect(page.getByTestId('copy-dialog')).toBeVisible(); // over the card window (CR-25)
    await sweep(page, shot, 'dialog-copy');
    await page.keyboard.press('Escape');

    await page.goto('/reports');
    await page.getByTestId('effort-csv').click();
    await expect(page.getByTestId('csv-from')).toBeVisible();
    await sweep(page, shot, 'dialog-csv');
    await page.keyboard.press('Escape');

    await page.goto('/admin/projects');
    await page.getByTestId(`admin-project-${project.id}`).getByTestId('project-close').click();
    await expect(page.getByTestId('close-open-cards')).toBeVisible();
    await sweep(page, shot, 'dialog-close-project');
    await page.keyboard.press('Escape');

    await page.goto(`/admin/teams/${PLATFORM}`);
    await page.getByTestId('member-remove').first().click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await sweep(page, shot, 'dialog-member-removal');
  });

  test('the signed-out pages: sign-in, refused, signed out, expired', async ({ page, shot }) => {
    for (const [name, url] of [
      ['sign-in', '/sign-in'],
      ['refused', '/refused'],
      ['signed-out', '/signed-out'],
      ['expired', '/expired'],
    ] as const) {
      await page.goto(url);
      await expect(page.locator('h1').first()).toBeVisible();
      await sweep(page, shot, name);
    }
  });
});

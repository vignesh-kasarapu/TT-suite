// D-119 at three viewports: the top bar's notification bell (unread count, opens the Inbox) and
// light/dark toggle; the board's project legend on one line, whose chips filter the board.
import { expect, test } from './_fixtures/test';
import { fixtureId, resetPreferences, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

test('top bar: bell opens the Inbox; the toggle switches light and dark', async ({
  page,
  shot,
}) => {
  await signInViaApi(page, 'M1');
  await page.goto('/');
  await page.getByTestId('bell').click();
  await expect(page).toHaveURL(/\/inbox$/);
  const html = page.locator('html');
  await page.getByTestId('theme-toggle').click();
  const first = await html.getAttribute('data-theme');
  await page.getByTestId('theme-toggle').click();
  await expect(html).not.toHaveAttribute('data-theme', first ?? '');
  await shot('topbar');
  await resetPreferences(page);
});

test('board legend: one chip per project, a click filters the board to it', async ({
  page,
  shot,
}) => {
  await signInViaApi(page, 'ADMIN');
  const name = `Legend ${page.viewportSize()?.width ?? 0} ${Date.now()}`;
  const res = await page.request.post('/api/v1/projects', {
    headers: CSRF,
    data: { name, teamId: PLATFORM },
  });
  expect(res.status(), await res.text()).toBe(201);
  const project = (await res.json()) as { id: string };
  const card = await page.request.post('/api/v1/cards', {
    headers: CSRF,
    data: { title: `${name} card`, plane: 'org', teamId: PLATFORM, projectId: project.id },
  });
  expect(card.status(), await card.text()).toBe(201);
  await page.goto(`/teams/${PLATFORM}`);
  const legend = page.getByTestId('project-legend');
  await expect(legend).toBeVisible();
  if (await page.getByTestId('legend-more').isVisible()) {
    const more = page.getByTestId('legend-more');
    if ((await more.getAttribute('aria-expanded')) === 'false') await more.click();
  }
  await legend.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('filter-project')).toHaveValue(project.id);
  await shot('legend');
});

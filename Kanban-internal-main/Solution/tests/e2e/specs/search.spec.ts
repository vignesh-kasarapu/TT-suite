// FR-054 search page at three viewports: searches as you type, filters show as removable chips,
// Clear all resets them, results open the card.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string };
}

test('search: type to find, filter by chips, clear all, open the card', async ({
  page,
  shot,
  axe,
}) => {
  await signInViaApi(page, 'M1');
  const word = `zq${Date.now()}`;
  const ready = await apiCreate(page, {
    title: `Search ready ${word}`,
    plane: 'org',
    teamId: PLATFORM,
    state: 'ready',
  });
  const backlog = await apiCreate(page, {
    title: `Search backlog ${word}`,
    plane: 'org',
    teamId: PLATFORM,
    state: 'backlog',
  });
  await page.goto('/search');
  await page.getByTestId('search-input').fill(word); // no button press: it searches as you type
  await expect(page.getByTestId(`hit-${ready.key}`)).toBeVisible();
  await expect(page.getByTestId(`hit-${backlog.key}`)).toBeVisible();

  // Phones (< 640 px) fold the filters behind a button.
  if ((page.viewportSize()?.width ?? 0) < 640)
    await page.getByTestId('search-filters-toggle').click();
  await page.getByTestId('search-state').selectOption('ready');
  await expect(page.getByTestId('chip-state')).toContainText('Ready');
  await expect(page.getByTestId(`hit-${backlog.key}`)).toHaveCount(0);
  await shot('search');
  await axe('search-page');

  await page.getByTestId('chip-state').click();
  await expect(page.getByTestId(`hit-${backlog.key}`)).toBeVisible();
  await page.getByTestId('search-state').selectOption('backlog');
  await page.getByTestId('search-clear').click();
  await expect(page.getByTestId('search-chips')).toHaveCount(0);
  await expect(page.getByTestId('search-input')).toHaveValue(word);

  await page.getByTestId(`hit-${ready.key}`).getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/cards/${ready.key}$`));
});

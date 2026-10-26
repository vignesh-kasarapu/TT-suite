// D-154 at desktop / tablet / mobile: My time as the user's mockup - the ring and stat tiles, the
// entries grouped by day or by card, the breakdown chart, and the note behind "Add note". Works
// on whatever week the app is in.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const WEB = fixtureId('TEAM_WEB');

async function apiCreate(page: Page, body: Record<string, unknown>) {
  const res = await page.request.post('/api/v1/cards', { headers: CSRF, data: body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as { key: string };
}

test.describe('D-154 my time look', () => {
  test('ring, tiles, log, group by card, breakdown, note', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'M2');
    const width = page.viewportSize()?.width ?? 0;
    const title = `My time look ${width} ${Date.now()}`;
    const card = await apiCreate(page, { title, plane: 'org', teamId: WEB });
    await page.goto('/time');
    await expect(page.getByTestId('time-ring')).toBeVisible();
    for (const id of ['stat-remaining', 'stat-entries', 'stat-days-off'])
      await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('time-breakdown')).toBeVisible();

    // Log on the card through the form.
    await page.getByTestId('time-card').click();
    await page.getByTestId('time-card-search').fill(title);
    await page.getByTestId(`time-card-option-${card.key}`).click();
    await page.getByTestId('time-log-hours').fill('2');
    await page.getByTestId('time-log-note').fill('look check');
    await expect(page.getByTestId('time-log-form')).toContainText('10/500');
    await page.getByTestId('time-log-submit').click();
    await expect(page.getByTestId('my-entry').filter({ hasText: card.key })).toHaveCount(1);

    // Group by card: the card is a heading with its total.
    await page.getByTestId('entries-group').selectOption('card');
    await expect(
      page.getByTestId('my-entries').getByRole('heading', { name: new RegExp(card.key) }),
    ).toContainText('2 h');
    await shot('my-time-look');
    await axe('my-time-look');

    // The note opens from "Add note" (or "Edit" when the week has one) and shows once saved.
    await page.getByTestId('note-add').click();
    const note = `Look note ${Date.now()}`;
    await page.getByTestId('week-note').fill(note);
    await page.getByTestId('week-note-save').click();
    await expect(page.getByTestId('note-view')).toContainText(note);
    await expect(page.getByTestId('note-add')).toHaveText(/Edit/);
  });
});

// CR-25 at desktop / tablet / mobile: from 640 px a card opens as a modal window over the dimmed
// board (Escape or a click outside closes it; unsaved Details edits ask first); below 640 it
// stays a full page.
import { expect, test } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

test.describe('CR-25 card window', () => {
  test('the card is a modal window over the board; Escape and an outside click close it', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'M1');
    const width = page.viewportSize()?.width ?? 0;
    const res = await page.request.post('/api/v1/cards', {
      headers: CSRF,
      data: { title: `CR25 window ${width} ${Date.now()}`, plane: 'org', teamId: PLATFORM },
    });
    expect(res.status()).toBe(201);
    const { key } = (await res.json()) as { key: string };
    const board = `/teams/${PLATFORM}`;
    const cardUrl = `${board}/cards/${key}`;
    await page.goto(cardUrl);

    if (width < 640) {
      await expect(page.getByTestId('card-page')).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await shot('cr25-card');
      return;
    }

    const win = page.getByTestId('card-panel');
    await expect(win).toBeVisible();
    // A real modal: the board behind is inert and dimmed by the ::backdrop.
    expect(await win.evaluate((d) => d.matches('dialog:modal'))).toBe(true);
    await shot('cr25-card');

    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${board}$`));

    // A click on the dimmed area outside the window closes it.
    await page.goto(cardUrl);
    await expect(win).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(win).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${board}$`));

    // Unsaved Details edits ask first: Cancel keeps the card open, OK closes it.
    await page.goto(cardUrl);
    await page.getByTestId('detail-title').fill('Changed, not saved');
    page.once('dialog', (d) => void d.dismiss());
    await page.mouse.click(5, 5);
    await expect(win).toBeVisible();
    page.once('dialog', (d) => void d.accept());
    await page.mouse.click(5, 5);
    await expect(win).toHaveCount(0);
  });
});

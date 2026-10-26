// B02 — S12 Preferences: cycling buttons, immediate apply, server persistence across devices
// (TC-148 desktop, TC-149 tablet, TC-150 mobile; each runs at all three viewports).
import { expect, test } from './_fixtures/test';
import { resetPreferences, signInViaApi } from './_fixtures/users';

test.describe('B02 preferences (FR-170, D-112)', () => {
  test.beforeEach(async ({ page }) => {
    await signInViaApi(page, 'M1');
    await resetPreferences(page);
  });

  test('TC-149 B02-13 preset cycling persists: labels Linen → Harbour → Graphite → Linen; after reload data-preset equals the last saved value', async ({
    page,
    shot,
    axe,
  }) => {
    await page.goto('/preferences');
    const button = page.getByTestId('preset-button');
    await expect(button).toHaveText('Linen');
    await expect(button).toHaveAttribute('aria-label', 'Theme preset: Linen, press to change');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'linen');
    for (const next of ['Harbour', 'Graphite', 'Linen']) {
      await button.click();
      await expect(button).toHaveText(next);
      await expect(button).toHaveAttribute('aria-label', `Theme preset: ${next}, press to change`);
      await expect(page.locator('html')).toHaveAttribute('data-preset', next.toLowerCase());
      await expect(page.getByRole('status')).toContainText('Saved.');
    }
    await shot('preferences');
    await axe('preferences');
    // Leave the last saved value as Graphite so the reload check is not the default.
    await button.click();
    await expect(button).toHaveText('Harbour');
    await expect(page.getByRole('status')).toContainText('Saved.');
    await page.reload();
    await expect(page.getByTestId('preset-button')).toHaveText('Harbour');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'harbour');
  });

  test('CR-19 inbox retention is a preference: the window saves and survives a reload', async ({
    page,
  }) => {
    await page.goto('/preferences');
    const retention = page.getByTestId('inbox-window');
    await expect(retention).toHaveValue('30'); // the old hard-coded WINDOW_DAYS, now the default
    await retention.selectOption('7');
    await expect(page.getByRole('status')).toContainText('Saved.');
    await page.reload();
    await expect(page.getByTestId('inbox-window')).toHaveValue('7');
  });

  test('TC-150 B02-13 mode cycling applies immediately: labels System → Light → Dark → System; data-theme follows each press without reload', async ({
    page,
    shot,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/preferences');
    const button = page.getByTestId('mode-button');
    await expect(button).toHaveText('System');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // system = OS dark
    for (const [label, theme] of [
      ['Light', 'light'],
      ['Dark', 'dark'],
      ['System', 'dark'],
    ] as const) {
      await button.click();
      await expect(button).toHaveText(label);
      await expect(button).toHaveAttribute('aria-label', `Colour mode: ${label}, press to change`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('status')).toContainText('Saved.');
    }
    await shot('preferences-mode');
  });

  test('TC-148 B02-13 theme follows to another device: context A (mobile) sets Dark; context B (desktop) signs in → data-theme dark, label "Dark"', async ({
    browser,
    shot,
  }) => {
    const a = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const pageA = await a.newPage();
    await signInViaApi(pageA, 'M1');
    await resetPreferences(pageA);
    await pageA.goto('/preferences');
    const modeA = pageA.getByTestId('mode-button');
    await expect(modeA).toHaveText('System');
    // Press until the label reads "Dark" (System → Light → Dark), waiting for each press to apply and save.
    for (let presses = 0; presses < 3; presses++) {
      const before = (await modeA.textContent())?.trim();
      if (before === 'Dark') break;
      await modeA.tap();
      await expect(modeA).not.toHaveText(before ?? '');
      await expect(pageA.getByRole('status')).toContainText('Saved.');
    }
    await expect(modeA).toHaveText('Dark');
    await a.close();

    const b = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageB = await b.newPage();
    await signInViaApi(pageB, 'M1');
    await pageB.goto('/preferences');
    await expect(pageB.locator('html')).toHaveAttribute('data-theme', 'dark');
    const modeB = pageB.getByTestId('mode-button');
    await expect(modeB).toHaveText('Dark');
    await expect(modeB).toHaveAttribute('aria-label', /Colour mode: Dark, press to change/);
    await pageB
      .screenshot({
        path: `${process.cwd()}/Solution/tests/e2e/test-results/screenshots/preferences-other-device-desktop.png`,
        fullPage: true,
      })
      .catch(() => undefined);
    await resetPreferences(pageB);
    await b.close();
    void shot;
  });
});

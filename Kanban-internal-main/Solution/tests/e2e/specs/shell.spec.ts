// B01 — app shell at three viewports (TC-007/008/009, TC-025/026/027, TC-028, TC-029, TC-030).
// Every test runs with the CSP-violation fixture (auto) and the @smoke tests also run on
// desktop-webkit / desktop-firefox / mobile-webkit. Since B02 the shell sits behind a
// session: each test signs in as E1 (employee nav set) through the real sign-in endpoint.
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

test.beforeEach(async ({ page }) => {
  await signInViaApi(page, 'M1');
});

// S2 nav set for a member (FR-071): Teams / Unassigned join the bar; Programs, Search and
// Preferences move to the "More" sheet on mobile.
const NAV_LABELS = ['My board', 'Teams', 'Programs', 'Reports', 'Search', 'Preferences'];
const BAR_LABELS = ['My board', 'Teams', 'My time'];
const MORE_ITEMS = ['Programs', 'Reports', 'Search', 'Preferences', 'Sign out'];

test.describe('B01 shell', () => {
  test('TC-007/008/009 B01-4 SPA loads with zero CSP violations, incl. a Google Font preset switch @smoke', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kanban/);
    await expect(page.getByRole('heading', { level: 1, name: 'My board' })).toBeVisible();
    // Switch preset to one that loads a Google Font (Harbour → Inter from fonts.googleapis.com).
    await page.evaluate(() => window.appTheme.applyPreset('harbour'));
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'harbour');
    await expect(page.locator('link[data-font="harbour"]')).toHaveCount(1);
    await page.waitForTimeout(500); // let the stylesheet + font requests settle so a violation would have fired
    // The auto CSP fixture asserts zero violations after the test body.
  });

  test('TC-025/026/027 B01-11 shell renders per viewport; logo; board; 404 page @smoke', async ({
    page,
    axe,
    shot,
  }, testInfo) => {
    const width = page.viewportSize()?.width ?? 0;
    await page.goto('/');
    await expect(page.getByRole('img', { name: 'Tektalis' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'linen');

    await expect(page.getByTestId('columns')).toBeVisible();
    await expect(page.getByTestId('skeleton')).toHaveCount(0);

    const nav = page.getByTestId('nav');
    await expect(nav).toBeVisible();
    if (width >= 1024) {
      // Desktop: persistent side nav with visible text labels.
      for (const label of NAV_LABELS)
        await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
      for (const label of NAV_LABELS) {
        const span = nav.getByRole('link', { name: label, exact: true }).locator('span');
        const box = await span.boundingBox();
        expect(box?.width ?? 0, `${label} label is visibly rendered`).toBeGreaterThan(1);
      }
    } else if (width >= 640) {
      // Tablet: 72 px icon rail, labels present for AT but visually hidden.
      const box = await nav.boundingBox();
      expect(Math.round(box?.width ?? 0)).toBe(72);
      for (const label of NAV_LABELS) {
        const link = nav.getByRole('link', { name: label, exact: true });
        await expect(link).toBeVisible();
        const span = await link.locator('span').boundingBox();
        expect(span?.width ?? 0, `${label} label visually hidden`).toBeLessThanOrEqual(1);
      }
    } else {
      // Mobile (D-034): bottom bar = 4 role-derived nav items + the "More" trigger; "More"
      // sheet opens and closes; every tap target ≥ 44 px.
      const links = nav.getByRole('link');
      await expect(links).toHaveCount(BAR_LABELS.length);
      await expect(links).toHaveText(BAR_LABELS);
      const more = nav.getByRole('button', { name: 'More' });
      await expect(more).toBeVisible();
      const items = nav.locator('a, button');
      await expect(items).toHaveCount(BAR_LABELS.length + 1);
      for (const item of await items.all()) {
        const box = await item.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await more.tap();
      const sheet = page.getByTestId('more-sheet');
      await expect(sheet).toBeVisible();
      for (const label of MORE_ITEMS)
        await expect(sheet.getByText(label, { exact: true })).toBeVisible();
      await shot('more-sheet');
      for (const target of await sheet.locator('a, button').all()) {
        const box = await target.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await sheet.getByRole('button', { name: 'Close' }).tap();
      await expect(sheet).toBeHidden();
    }

    await shot('home');
    // Axe artefact (non-gating): test-results/axe/shell-<viewport>.json
    const a11y = await axe('shell');
    testInfo.annotations.push({
      type: 'axe',
      description: `serious=${a11y.serious} critical=${a11y.critical}`,
    });

    // 404 page for a bad URL (not blank).
    await page.goto('/does-not-exist');
    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.getByTestId('not-found')).toContainText('Page not found');
    await expect(page.getByRole('img', { name: 'Tektalis' })).toBeVisible();
    await shot('not-found');
    await axe('not-found');
  });

  test('TC-028 B01-11 system dark mode flips data-theme; default preset linen', async ({
    page,
    shot,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'linen');
    await expect(page.getByTestId('columns')).toBeVisible();
    await shot('board-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'linen');
  });
});

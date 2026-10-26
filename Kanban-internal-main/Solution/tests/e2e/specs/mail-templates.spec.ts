// D-140 / D-141 at three viewports: Administration > Email templates (edit, insert a
// placeholder, preview, save, reset) and the Team time CSV download.
import { expect, test } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };

test.describe('D-141 email templates', () => {
  test('an admin edits, previews, saves and resets an email', async ({ page, shot, axe }) => {
    await signInViaApi(page, 'ADMIN');
    await page.goto('/admin/mail-templates');
    await expect(page.getByTestId('admin-mail-templates')).toBeVisible();
    await page.getByTestId('mail-kind').selectOption('blocked');
    await page.getByTestId('mail-subject').fill('Blocked: {cardKey}');
    await page.getByTestId('mail-body').fill('Heads up - ');
    await page.getByTestId('mail-placeholder-cardTitle').click();
    await expect(page.getByTestId('mail-body')).toHaveValue('Heads up - {cardTitle}');

    await page.getByTestId('mail-preview').click();
    await expect(page.getByTestId('mail-preview-subject')).toHaveText('Blocked: K-42');
    await shot('mail-templates');
    await axe('mail-templates');

    await page.getByTestId('mail-save').click();
    await expect(page.getByTestId('mail-saved')).toBeVisible();
    await expect(page.getByTestId('mail-kind')).toContainText('(edited)');

    // Back to the built-in wording, so other specs see the usual emails.
    await page.getByTestId('mail-reset').click();
    await page
      .getByTestId('mail-reset-dialog')
      .getByRole('button', { name: 'Reset to default' })
      .click();
    await expect(page.getByTestId('mail-subject')).toHaveValue(
      '[Kanban] Your card is blocked: {cardKey}',
    );
  });

  test('a member cannot open Email templates', async ({ page }) => {
    await signInViaApi(page, 'M1');
    await page.goto('/admin/mail-templates');
    await expect(page.getByTestId('admin-mail-templates')).toHaveCount(0);
    const res = await page.request.get('/api/v1/admin/mail-templates', { headers: CSRF });
    expect(res.status()).toBe(403);
  });
});

test.describe('D-140 team time download', () => {
  test('Team time downloads the shown week as CSV', async ({ page }) => {
    await signInViaApi(page, 'ADMIN');
    const team = fixtureId('TEAM_PLATFORM');
    await page.goto(`/team-time?team=${team}`);
    await page.getByTestId('team-export-open').click(); // D-156: in the Export menu
    const link = page.getByTestId('team-time-download');
    await expect(link).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^time-platform-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

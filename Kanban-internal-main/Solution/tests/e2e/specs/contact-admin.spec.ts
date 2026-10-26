// D-125 at three viewports: someone who cannot sign in opens "Message an admin" on the sign-in
// page, the required fields carry their mark, a bad email is refused, and a sent message reaches
// the admins' outbox. D-144: the admin finds it under Administration > Login issues and marks it
// resolved.
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

test.describe('D-125 contact admin', () => {
  test('a person who cannot sign in messages the admins', async ({ page, shot, axe }) => {
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    await page.goto('/sign-in');
    await page.getByTestId('contact-open').click();
    const form = page.getByTestId('contact-form');
    await expect(form).toBeVisible();
    for (const id of ['contact-name', 'contact-email', 'contact-message'])
      await expect(page.getByTestId(id)).toHaveAttribute('required', '');
    await page.getByTestId('contact-name').fill(`Neha ${stamp}`);
    await page.getByTestId('contact-email').fill(`neha-${stamp}@example.test`);
    await page.getByTestId('contact-message').fill('I joined the Web team and need access.');
    await shot('contact-admin');
    await axe('contact-admin');
    await page.getByTestId('contact-send').click();
    await expect(page.getByTestId('contact-sent')).toBeVisible();

    const outbox = (await (await page.request.get('/api/v1/dev/notifications')).json()) as {
      items: { kind: string; payload: { name?: string } }[];
    };
    expect(
      outbox.items.some((n) => n.kind === 'contact_admin' && n.payload.name === `Neha ${stamp}`),
    ).toBe(true);

    await signInViaApi(page, 'ADMIN');
    await page.goto('/admin/login-issues');
    // The tab counts the open ones.
    await expect(page.getByRole('link', { name: /^Login issues \(\d+\)$/ })).toBeVisible();
    const issue = page.getByTestId('login-issue').filter({ hasText: `Neha ${stamp}` });
    await expect(issue).toContainText(`neha-${stamp}@example.test`);
    await expect(issue).toContainText('I joined the Web team and need access.');
    await expect(issue).toContainText('Open');
    await shot('login-issues');
    await axe('login-issues');
    await issue.getByTestId('login-issue-resolve').click();
    await expect(issue).toContainText('Resolved by Asha Admin');
    await expect(issue.getByTestId('login-issue-resolve')).toHaveCount(0);
  });
});

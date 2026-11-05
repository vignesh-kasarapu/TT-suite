import { expect, type Page } from '@playwright/test';

export type AppKey = 'lms' | 'expense' | 'kanban' | 'ams';
/** Apps this run leaves out (SUITE_SKIP, as the suite itself reads it). */
export const SKIPPED: ReadonlySet<string> = new Set(
  (process.env.SUITE_SKIP ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
/** The apps this deployment runs (the without-resume branch leaves out AMS too). */
export const APPS: AppKey[] = (['lms', 'expense', 'kanban', 'ams'] as AppKey[]).filter((a) => !SKIPPED.has(a));
/** Every app follows the suite's shared theme (chosen on the dashboard's Profile page). */
export const THEMED_APPS: AppKey[] = APPS;

/** The global admin from e2e/seed.json. */
export const ADMIN = 'e2e.admin@tektalis.com';

/** Writes need the CSRF header, as in the apps' own clients. */
export const XHR = { 'x-requested-with': 'XHR' };

/** A fresh address per test, so tests never depend on each other's people. */
export function uniqueEmail(label: string): string {
  return `e2e.${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
}

/** Dev sign-in through the API: the session cookie lands in the page's browser context. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  const res = await page.request.post('/api/auth/dev/sign-in', { data: { email }, headers: XHR });
  expect(res.status(), await res.text()).toBe(204);
}

/** A unique employee code for a test person (from their unique e2e email). */
export function employeeCode(email: string): string {
  return `E2E-${email.split('@')[0]!.replace(/[^A-Za-z0-9]/g, '').slice(-34)}`;
}

/** Invite through the admin API (the UI flow has its own test). Caller must be the admin. */
export async function invite(page: Page, email: string, access: Partial<Record<AppKey, string>>): Promise<{ id: string }> {
  const res = await page.request.post('/api/admin/users', {
    data: {
      email,
      employeeCode: employeeCode(email),
      // Roles in apps this deployment leaves out are dropped: there is nothing to grant there.
      access: Object.fromEntries(Object.entries(access).filter(([app]) => !SKIPPED.has(app)).map(([app, role]) => [app, { role }])),
    },
    headers: XHR,
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  expect(body.errors).toEqual([]);
  return body.user;
}

/** The app's own page has loaded inside the suite: its URL and its "Switch app" control. */
export async function expectAppOpened(page: Page, app: AppKey): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/${app}/`));
  await expect(page.getByLabel('Switch app').first()).toBeVisible();
}

/** Emails the stub mailer recorded for one address (dev profile only). */
export async function mailTo(page: Page, email: string): Promise<{ to: string; kind: string }[]> {
  const res = await page.request.get('/api/dev/mail');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.items.filter((m: { to: string }) => m.to === email);
}

/** The admin table's row for one person (desktop layout). */
export const userRow = (page: Page, email: string) => page.getByRole('row').filter({ hasText: email });

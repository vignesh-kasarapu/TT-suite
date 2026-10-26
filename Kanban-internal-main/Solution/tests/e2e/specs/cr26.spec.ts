// CR-26 at desktop / tablet / mobile: projects are attached in the program edit window; one that
// ends after the program offers to shrink the project or extend the program so the dates coincide.
import { expect, test, type Page } from './_fixtures/test';
import { fixtureId, signInViaApi } from './_fixtures/users';

const CSRF = { 'X-Requested-With': 'XHR' };
const PLATFORM = fixtureId('TEAM_PLATFORM');

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(`/api/v1/${url}`, { headers: CSRF, data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()) as T;
}

test.describe('CR-26 projects within programs', () => {
  test('attach in the program edit window; a later project asks to shrink it or extend the program', async ({
    page,
    shot,
  }) => {
    await signInViaApi(page, 'ADMIN');
    const stamp = `${page.viewportSize()?.width ?? 0}-${Date.now()}`;
    const prog = await post<{ id: string }>(page, 'programs', {
      name: `CR26 prog ${stamp}`,
      targetDate: '2026-09-30',
    });
    const late = await post<{ id: string }>(page, 'projects', {
      name: `CR26 late ${stamp}`,
      teamId: PLATFORM,
      targetDate: '2026-11-15',
    });
    const later = await post<{ id: string }>(page, 'projects', {
      name: `CR26 later ${stamp}`,
      teamId: PLATFORM,
      targetDate: '2026-12-20',
    });

    await page.goto('/admin/programs');
    await page.getByTestId(`admin-program-${prog.id}`).getByTestId('program-edit').click();
    await expect(page.getByTestId('program-projects')).toBeVisible();

    // Shrink: the project comes back to the program's end.
    await page.getByTestId('project-attach-pick').selectOption(late.id);
    await page.getByTestId('project-attach').click();
    await expect(page.getByTestId('date-conflict')).toContainText('2026-09-30');
    await shot('cr26-conflict');
    await page.getByTestId('conflict-shrink').click();
    await expect(page.getByTestId(`attached-${late.id}`)).toContainText('2026-09-30');

    // Extend: the program moves out to the project's end.
    await page.getByTestId('project-attach-pick').selectOption(later.id);
    await page.getByTestId('project-attach').click();
    await page.getByTestId('conflict-extend').click();
    await expect(page.getByTestId(`attached-${later.id}`)).toContainText('2026-12-20');
    await expect(page.getByTestId(`admin-program-${prog.id}`)).toContainText('2026-12-20');
    await shot('cr26-attached');

    // Detach puts the project back on the loose list.
    await page.getByTestId(`attached-${late.id}`).getByTestId('project-detach').click();
    await expect(page.getByTestId(`attached-${late.id}`)).toHaveCount(0);

    // The project form no longer carries a program picker (CR-26: one place to attach).
    await page.goto('/admin/projects');
    await expect(page.getByTestId('project-form')).toBeVisible();
    await expect(page.getByTestId('project-program')).toHaveCount(0);
  });
});

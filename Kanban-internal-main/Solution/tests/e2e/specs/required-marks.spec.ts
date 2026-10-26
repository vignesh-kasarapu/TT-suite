// D-124: a mandatory field's label ends in a red asterisk; an optional field's label has none.
// Checked on the new-card dialog, the admin project form and the My time log form.
import type { Locator } from '@playwright/test';
import { expect, test } from './_fixtures/test';
import { signInViaApi } from './_fixtures/users';

/** The label text of a control: the first `<span>` of the `<label>` around it (D-154: the
 *  control may sit in an icon wrapper inside the label). */
const labelOf = (control: Locator) => control.locator('xpath=ancestor::label[1]/span[1]');

async function marked(label: Locator): Promise<boolean> {
  return label.evaluate((el) => getComputedStyle(el, '::after').content.includes('*'));
}

test.describe('D-124 required-field marks', () => {
  test('required fields carry an asterisk, optional ones do not', async ({ page, shot }) => {
    await signInViaApi(page, 'ADMIN');

    await page.goto('/');
    await page.getByTestId('column-add-in_prep').click();
    expect(await marked(labelOf(page.getByTestId('new-card-title')))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('new-card-description')))).toBe(false);
    await shot('new-card-required');
    await page.keyboard.press('Escape');

    await page.goto('/admin/projects');
    expect(await marked(labelOf(page.getByTestId('project-name')))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('project-team')))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('project-target')))).toBe(false);

    await page.goto('/time');
    expect(await marked(page.locator('#time-card-label'))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('time-log-date')))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('time-log-hours')))).toBe(true);
    expect(await marked(labelOf(page.getByTestId('time-log-note')))).toBe(false);
    await shot('time-log-required');
  });
});

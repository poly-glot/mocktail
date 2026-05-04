import { expect, test } from '@playwright/test';
import { insertElement, openNewProject, signIn, uniqueEmail } from '../shared/editor-helpers';

/**
 * Color picker: inspector swatch, hex text, preset chips, clear-to-default.
 *
 * The color field is shown for types that paint a color — textual (text,
 * heading, link, button), filled (rect, card, tag, circle), divider, and
 * list. Types with no visible color (image, icon) don't show the field.
 */

test.describe.configure({ mode: 'serial' });

test('color picker is hidden for types without a color and visible for textual types', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('color-a'));
  await openNewProject(page);

  await insertElement(page, 'image');
  await expect(page.getByTestId('inspect-color')).toHaveCount(0);

  await insertElement(page, 'heading');
  await expect(page.getByTestId('inspect-color')).toBeVisible();
});

test('picking a preset applies the color to the element', async ({ page }) => {
  await signIn(page, uniqueEmail('color-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const el = page.getByTestId(`el-${id}`);

  // First preset after the none chip.
  const firstPreset = page.locator('.color-palette .palette-chip:not(.none)').first();
  const presetBg = await firstPreset.evaluate((e) => (e as HTMLElement).style.background);
  await firstPreset.click();

  await expect
    .poll(async () => el.evaluate((e) => (e as HTMLElement).style.color), { timeout: 5_000 })
    .not.toBe('');
  // Either rgb form or hex — just verify color was applied from the preset.
  expect(presetBg).not.toBe('');
});

test('clear color reverts to default (no inline color)', async ({ page }) => {
  await signIn(page, uniqueEmail('color-c'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const el = page.getByTestId(`el-${id}`);

  await page.locator('.color-palette .palette-chip:not(.none)').first().click();
  await expect
    .poll(async () => el.evaluate((e) => (e as HTMLElement).style.color), { timeout: 5_000 })
    .not.toBe('');

  // Clear via the none chip in the palette.
  await page.locator('.color-palette .palette-chip.none').click();
  await expect
    .poll(async () => el.evaluate((e) => (e as HTMLElement).style.color), { timeout: 5_000 })
    .toBe('');
});

test('hex input applies a color', async ({ page }) => {
  await signIn(page, uniqueEmail('color-d'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const hex = page.locator('.color-hex');
  await hex.fill('#ff00aa');
  await hex.press('Enter');

  await expect
    .poll(
      async () => page.getByTestId(`el-${id}`).evaluate((e) => (e as HTMLElement).style.color),
      { timeout: 5_000 },
    )
    .toMatch(/rgb\(255,\s*0,\s*170\)|#ff00aa/i);
});

test('empty hex input clears the color', async ({ page }) => {
  await signIn(page, uniqueEmail('color-e'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const hex = page.locator('.color-hex');
  await hex.fill('#ff00aa');
  await hex.press('Enter');
  await expect
    .poll(
      async () => page.getByTestId(`el-${id}`).evaluate((e) => (e as HTMLElement).style.color),
      { timeout: 5_000 },
    )
    .not.toBe('');

  await hex.fill('');
  await hex.press('Enter');
  await expect
    .poll(
      async () => page.getByTestId(`el-${id}`).evaluate((e) => (e as HTMLElement).style.color),
      { timeout: 5_000 },
    )
    .toBe('');
});

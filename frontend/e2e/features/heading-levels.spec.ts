import { expect, test } from '@playwright/test';
import { insertElement, openNewProject, signIn, uniqueEmail } from '../shared/editor-helpers';

/**
 * Heading levels: inspector H1..H6 segmented buttons update `level`,
 * which drives font size via headingFontSizeFor().
 */

test.describe.configure({ mode: 'serial' });

test('heading defaults to H1 and shows active state in inspector', async ({ page }) => {
  await signIn(page, uniqueEmail('heading-a'));
  await openNewProject(page);

  await insertElement(page, 'heading');
  await expect(page.getByTestId('level-1')).toHaveClass(/\bactive\b/);
});

test('selecting H3 changes the active level and font size', async ({ page }) => {
  await signIn(page, uniqueEmail('heading-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const el = page.getByTestId(`el-${id}`);
  const h1Size = await el.evaluate((e) => (e as HTMLElement).style.fontSize);

  await page.getByTestId('level-3').click();
  await expect(page.getByTestId('level-3')).toHaveClass(/\bactive\b/);
  await expect(page.getByTestId('level-1')).not.toHaveClass(/\bactive\b/);

  const h3Size = await el.evaluate((e) => (e as HTMLElement).style.fontSize);
  expect(h3Size).not.toBe(h1Size);
});

test('cycling through H1..H6 updates active state every step', async ({ page }) => {
  await signIn(page, uniqueEmail('heading-c'));
  await openNewProject(page);

  await insertElement(page, 'heading');
  for (const n of [2, 3, 4, 5, 6, 1]) {
    await page.getByTestId(`level-${n}`).click();
    await expect(page.getByTestId(`level-${n}`)).toHaveClass(/\bactive\b/);
  }
});

test('level controls do not appear for non-heading element types', async ({ page }) => {
  await signIn(page, uniqueEmail('heading-d'));
  await openNewProject(page);

  await insertElement(page, 'text');
  await expect(page.getByTestId('level-1')).toHaveCount(0);
});

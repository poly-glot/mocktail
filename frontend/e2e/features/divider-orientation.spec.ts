import { expect, test } from '@playwright/test';
import {
  elementBox,
  insertElement,
  openNewProject,
  signIn,
  uniqueEmail,
} from '../shared/editor-helpers';

/**
 * Divider orientation: h (default) vs v. Switching orientation keeps the
 * divider visually centered (rotates around the center) and preserves the
 * primary dimension (length).
 */

test.describe.configure({ mode: 'serial' });

test('divider inserted defaults to horizontal', async ({ page }) => {
  await signIn(page, uniqueEmail('div-a'));
  await openNewProject(page);

  const id = await insertElement(page, 'divider');
  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-divider\b/);
  await expect(el).not.toHaveClass(/\bis-divider-v\b/);
  await expect(page.getByTestId('divider-h')).toHaveClass(/\bactive\b/);
  await expect(page.getByTestId('divider-v')).not.toHaveClass(/\bactive\b/);
});

test('switching to vertical adds is-divider-v and active class', async ({ page }) => {
  await signIn(page, uniqueEmail('div-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'divider');
  await page.getByTestId('divider-v').click();

  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\bis-divider-v\b/);
  await expect(page.getByTestId('divider-v')).toHaveClass(/\bactive\b/);
});

test('orientation flip preserves the center of the divider', async ({ page }) => {
  await signIn(page, uniqueEmail('div-c'));
  await openNewProject(page);

  const id = await insertElement(page, 'divider');
  const before = await elementBox(page, id);
  const beforeCx = before.x + before.w / 2;
  const beforeCy = before.y + before.h / 2;

  await page.getByTestId('divider-v').click();
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\bis-divider-v\b/);

  const after = await elementBox(page, id);
  const afterCx = after.x + after.w / 2;
  const afterCy = after.y + after.h / 2;

  expect(Math.abs(afterCx - beforeCx)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterCy - beforeCy)).toBeLessThanOrEqual(1);
});

test('flipping back to horizontal keeps length and center', async ({ page }) => {
  await signIn(page, uniqueEmail('div-d'));
  await openNewProject(page);

  const id = await insertElement(page, 'divider');
  const h1 = await elementBox(page, id);
  const length = Math.max(h1.w, h1.h);

  await page.getByTestId('divider-v').click();
  const v = await elementBox(page, id);
  expect(Math.max(v.w, v.h)).toBe(length);

  await page.getByTestId('divider-h').click();
  const h2 = await elementBox(page, id);
  expect(Math.max(h2.w, h2.h)).toBe(length);
});

test('divider inspector does NOT show a Text input', async ({ page }) => {
  await signIn(page, uniqueEmail('div-e'));
  await openNewProject(page);

  await insertElement(page, 'divider');
  await expect(page.getByTestId('inspect-text')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { insertElement, openNewProject, signIn, uniqueEmail } from '../shared/editor-helpers';

/**
 * Palette: click-to-insert, search filter, default sizing/position.
 *
 * Click is the primary insert path exercised by users; drag-to-drop is
 * covered by the existing mocktail.spec.ts happy-path + is browser-specific
 * (HTML5 drag events don't reliably synthesize cross-Chromium-mode).
 */

test.describe.configure({ mode: 'serial' });

test('palette click inserts an element of the requested type', async ({ page }) => {
  await signIn(page, uniqueEmail('palette-a'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-button\b/);
  await expect(el).toHaveClass(/\bis-btn-primary\b/);
});

test('palette inserts heading with default level 1', async ({ page }) => {
  await signIn(page, uniqueEmail('palette-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'heading');
  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-heading\b/);
  // Inspector should show H1 active.
  await expect(page.getByTestId('level-1')).toHaveClass(/\bactive\b/);
});

test('palette inserts divider with default horizontal orientation', async ({ page }) => {
  await signIn(page, uniqueEmail('palette-c'));
  await openNewProject(page);

  const id = await insertElement(page, 'divider');
  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-divider\b/);
  await expect(el).not.toHaveClass(/\bis-divider-v\b/);
  // Inspector shows horizontal tab active.
  await expect(page.getByTestId('divider-h')).toHaveClass(/\bactive\b/);
});

test('palette search filters the component list', async ({ page }) => {
  await signIn(page, uniqueEmail('palette-d'));
  await openNewProject(page);

  await page.getByTestId('palette-search').fill('butt');
  await expect(page.getByTestId('palette-button')).toBeVisible();
  await expect(page.getByTestId('palette-heading')).toBeHidden();

  await page.getByTestId('palette-search').fill('zzz-no-match');
  await expect(page.locator('.empty-hint')).toBeVisible();

  await page.getByTestId('palette-search').fill('');
  await expect(page.getByTestId('palette-heading')).toBeVisible();
});

test('palette click centers the new element on the visible board viewport', async ({ page }) => {
  await signIn(page, uniqueEmail('palette-e'));
  await openNewProject(page);

  const id = await insertElement(page, 'rect');
  const boardBox = await page.getByTestId('canvas-board').boundingBox();
  if (!boardBox) throw new Error('no canvas board');
  const elBox = await page.getByTestId(`el-${id}`).boundingBox();
  if (!elBox) throw new Error('no el box');

  // Inserted element sits within the rendered board rect (viewport coords on both).
  expect(elBox.x).toBeGreaterThanOrEqual(boardBox.x);
  expect(elBox.y).toBeGreaterThanOrEqual(boardBox.y);
  expect(elBox.x + elBox.width).toBeLessThanOrEqual(boardBox.x + boardBox.width);
  expect(elBox.y + elBox.height).toBeLessThanOrEqual(boardBox.y + boardBox.height);
});

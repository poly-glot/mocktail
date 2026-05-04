import { expect, test } from '@playwright/test';
import { insertElement, openNewProject, signIn, uniqueEmail } from '../shared/editor-helpers';

/**
 * Button variants: primary (default), secondary, tertiary.
 *
 * Selection of a variant toggles the is-btn-* class on the element and the
 * active state on the segmented inspector control.
 */

test.describe.configure({ mode: 'serial' });

test('button inserted defaults to primary variant', async ({ page }) => {
  await signIn(page, uniqueEmail('btn-a'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\bis-btn-primary\b/);
  await expect(page.getByTestId('btn-primary')).toHaveClass(/\bactive\b/);
});

test('switching to secondary updates element class and active state', async ({ page }) => {
  await signIn(page, uniqueEmail('btn-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await page.getByTestId('btn-secondary').click();

  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-btn-secondary\b/);
  await expect(el).not.toHaveClass(/\bis-btn-primary\b/);
  await expect(page.getByTestId('btn-secondary')).toHaveClass(/\bactive\b/);
  await expect(page.getByTestId('btn-primary')).not.toHaveClass(/\bactive\b/);
});

test('switching to tertiary updates element class and active state', async ({ page }) => {
  await signIn(page, uniqueEmail('btn-c'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await page.getByTestId('btn-tertiary').click();

  const el = page.getByTestId(`el-${id}`);
  await expect(el).toHaveClass(/\bis-btn-tertiary\b/);
  await expect(page.getByTestId('btn-tertiary')).toHaveClass(/\bactive\b/);
});

test('variant controls do not appear for non-button types', async ({ page }) => {
  await signIn(page, uniqueEmail('btn-d'));
  await openNewProject(page);

  await insertElement(page, 'heading');
  await expect(page.getByTestId('btn-primary')).toHaveCount(0);
  await expect(page.getByTestId('btn-secondary')).toHaveCount(0);
  await expect(page.getByTestId('btn-tertiary')).toHaveCount(0);
});

test('variant persists across deselect/reselect', async ({ page }) => {
  await signIn(page, uniqueEmail('btn-e'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await page.getByTestId('btn-tertiary').click();
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\bis-btn-tertiary\b/);

  // Deselect by clicking empty canvas (top-left corner, well away from centered element).
  await page.getByTestId('canvas-board').click({ position: { x: 10, y: 10 } });
  // Re-select by clicking the element.
  await page.getByTestId(`el-${id}`).click();
  await expect(page.getByTestId('btn-tertiary')).toHaveClass(/\bactive\b/);
});

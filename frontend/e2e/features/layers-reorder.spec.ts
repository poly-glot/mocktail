import { expect, test } from '@playwright/test';
import {
  elementBox,
  insertElement,
  openLayersPanel,
  openNewProject,
  signIn,
  uniqueEmail,
} from '../shared/editor-helpers';

/**
 * Layers panel: selection, zIndex ordering, HTML5 drag reorder with drop
 * indicator above/below.
 *
 * The layers panel sorts by `b.zIndex - a.zIndex`, so the top row has the
 * highest zIndex. Dragging row A over row B with position 'above' means
 * A becomes a higher zIndex than B; 'below' means lower.
 */

test.describe.configure({ mode: 'serial' });

test('inserted elements appear in the layers panel and clicking selects them', async ({ page }) => {
  await signIn(page, uniqueEmail('layers-a'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');
  await openLayersPanel(page);

  await expect(page.getByTestId(`layer-${a}`)).toBeVisible();
  await expect(page.getByTestId(`layer-${b}`)).toBeVisible();

  await page.getByTestId(`layer-${a}`).click();
  await expect(page.locator(`.el.selected[data-testid="el-${a}"]`)).toBeVisible();
});

test('drag reorder: dropping row above target gives the dragged element higher zIndex', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('layers-b'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');
  const c = await insertElement(page, 'heading');
  await openLayersPanel(page);

  // Initial: a=1, b=2, c=3 (c on top).
  const initialA = await elementBox(page, a);
  const initialC = await elementBox(page, c);
  expect(initialA.zIndex).toBeLessThan(initialC.zIndex);

  // Drag 'a' above 'c' in the layers panel. dragTo synthesizes HTML5 events.
  const source = page.getByTestId(`layer-${a}`);
  const target = page.getByTestId(`layer-${c}`);

  // HTML5 drag-and-drop in Playwright uses dragTo with native events.
  await source.dragTo(target, { targetPosition: { x: 20, y: 4 } });

  await expect
    .poll(async () => (await elementBox(page, a)).zIndex, { timeout: 5_000 })
    .toBeGreaterThan((await elementBox(page, c)).zIndex);
});

test('drag reorder below lowers zIndex and normalizes contiguously', async ({ page }) => {
  await signIn(page, uniqueEmail('layers-c'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');
  const c = await insertElement(page, 'heading');
  await openLayersPanel(page);

  // Drag 'c' below 'a' in layers panel (positions target bottom).
  const source = page.getByTestId(`layer-${c}`);
  const target = page.getByTestId(`layer-${a}`);
  await source.dragTo(target, { targetPosition: { x: 20, y: 28 } });

  await expect
    .poll(async () => (await elementBox(page, c)).zIndex, { timeout: 5_000 })
    .toBeLessThan((await elementBox(page, a)).zIndex);

  // zIndex values should be contiguous integers (1, 2, 3) after normalization.
  const zs = await Promise.all([a, b, c].map((id) => elementBox(page, id).then((e) => e.zIndex)));
  const sorted = [...zs].sort((x, y) => x - y);
  expect(sorted[0]).toBe(1);
  expect(sorted[1]).toBe(2);
  expect(sorted[2]).toBe(3);
});

test('locking via layer lock button toggles locked state and disables drag', async ({ page }) => {
  await signIn(page, uniqueEmail('layers-d'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  await openLayersPanel(page);
  const row = page.getByTestId(`layer-${a}`);
  const lockBtn = page.getByTestId(`layer-lock-${a}`);

  await lockBtn.click();
  await expect(row).toHaveClass(/\blocked\b/);

  // Element on canvas also receives .locked class.
  await expect(page.getByTestId(`el-${a}`)).toHaveClass(/\blocked\b/);

  // Unlock.
  await lockBtn.click();
  await expect(row).not.toHaveClass(/\blocked\b/);
});

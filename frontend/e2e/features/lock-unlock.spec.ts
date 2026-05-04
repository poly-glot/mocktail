import { expect, test } from '@playwright/test';
import {
  elementBox,
  insertElement,
  openContextMenu,
  openLayersPanel,
  openNewProject,
  signIn,
  uniqueEmail,
} from '../shared/editor-helpers';

/**
 * Lock/unlock: three entry points (context menu ctx-lock, layer lock button,
 * keyboard). Locked elements don't move on pointer drag and resist the
 * resize/rotation handles.
 */

test.describe.configure({ mode: 'serial' });

test('layer lock button prevents element from moving via drag', async ({ page }) => {
  await signIn(page, uniqueEmail('lock-a'));
  await openNewProject(page);

  const id = await insertElement(page, 'rect');
  await openLayersPanel(page);
  const before = await elementBox(page, id);

  await page.getByTestId(`layer-lock-${id}`).click();
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\blocked\b/);

  // Attempt to drag the locked element.
  const el = page.getByTestId(`el-${id}`);
  const elBox = await el.boundingBox();
  if (!elBox) throw new Error('no el box');

  await page.mouse.move(elBox.x + 10, elBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(elBox.x + 200, elBox.y + 200, { steps: 10 });
  await page.mouse.up();

  const after = await elementBox(page, id);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
});

test('unlocking via layer button re-enables drag', async ({ page }) => {
  await signIn(page, uniqueEmail('lock-b'));
  await openNewProject(page);

  const id = await insertElement(page, 'rect');
  await openLayersPanel(page);
  await page.getByTestId(`layer-lock-${id}`).click();
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\blocked\b/);

  await page.getByTestId(`layer-lock-${id}`).click();
  await expect(page.getByTestId(`el-${id}`)).not.toHaveClass(/\blocked\b/);

  const before = await elementBox(page, id);
  const el = page.getByTestId(`el-${id}`);
  const elBox = await el.boundingBox();
  if (!elBox) throw new Error('no el box');

  await page.mouse.move(elBox.x + 10, elBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(elBox.x + 60, elBox.y + 60, { steps: 10 });
  await page.mouse.up();

  const after = await elementBox(page, id);
  expect(after.x !== before.x || after.y !== before.y).toBe(true);
});

test('ctx-lock menu item locks element and updates both canvas and layer rows', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('lock-c'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await openContextMenu(page, id);
  await page.getByTestId('ctx-lock').click();

  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\blocked\b/);
  await openLayersPanel(page);
  await expect(page.getByTestId(`layer-${id}`)).toHaveClass(/\blocked\b/);
});

test('locked element cannot be deleted via delete key', async ({ page }) => {
  await signIn(page, uniqueEmail('lock-d'));
  await openNewProject(page);

  const id = await insertElement(page, 'rect');
  await openLayersPanel(page);
  await page.getByTestId(`layer-lock-${id}`).click();
  await expect(page.getByTestId(`el-${id}`)).toHaveClass(/\blocked\b/);

  await page.getByTestId(`el-${id}`).click();
  await page.keyboard.press('Delete');

  // Element still present.
  await expect(page.getByTestId(`el-${id}`)).toBeVisible();
});

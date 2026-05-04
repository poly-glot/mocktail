import { expect, test } from '@playwright/test';
import {
  closeContextMenu,
  elementBox,
  insertElement,
  openContextMenu,
  openLayersPanel,
  openNewProject,
  signIn,
  uniqueEmail,
} from '../shared/editor-helpers';

/**
 * Context menu: open on right-click, z-order ops, lock toggle, delete, paste.
 *
 * Copy/Paste relies on internal clipboard (not OS clipboard) for emulator
 * resilience. z-order ops: bringToFront / sendToBack assign max+1 / min-1.
 */

test.describe.configure({ mode: 'serial' });

test('right-click opens the context menu with expected items', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-a'));
  await openNewProject(page);

  const id = await insertElement(page, 'rect');
  const menu = await openContextMenu(page, id);
  await expect(menu.getByText('Copy')).toBeVisible();
  await expect(menu.getByText('Paste')).toBeVisible();
  await expect(menu.getByText('Duplicate')).toBeVisible();
  await expect(menu.getByText('Delete')).toBeVisible();
  await expect(page.getByTestId('ctx-front')).toBeVisible();
  await expect(page.getByTestId('ctx-back')).toBeVisible();
  await expect(page.getByTestId('ctx-lock')).toBeVisible();

  await closeContextMenu(page);
  await expect(page.getByTestId('ctx-menu')).toBeHidden();
});

test('bring-to-front assigns the highest zIndex', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-b'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');
  const c = await insertElement(page, 'heading');

  await openContextMenu(page, a);
  await page.getByTestId('ctx-front').click();

  await expect
    .poll(async () => (await elementBox(page, a)).zIndex, { timeout: 5_000 })
    .toBeGreaterThan((await elementBox(page, b)).zIndex);
  expect((await elementBox(page, a)).zIndex).toBeGreaterThan((await elementBox(page, c)).zIndex);
});

test('send-to-back assigns the lowest zIndex', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-c'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');

  await openContextMenu(page, b);
  await page.getByTestId('ctx-back').click();

  await expect
    .poll(async () => (await elementBox(page, b)).zIndex, { timeout: 5_000 })
    .toBeLessThan((await elementBox(page, a)).zIndex);
});

test('ctx-lock toggles lock state', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-d'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  await openContextMenu(page, a);
  await page.getByTestId('ctx-lock').click();

  await expect(page.getByTestId(`el-${a}`)).toHaveClass(/\blocked\b/);
  await openLayersPanel(page);
  await expect(page.getByTestId(`layer-${a}`)).toHaveClass(/\blocked\b/);
});

test('delete via context menu removes the element', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-e'));
  await openNewProject(page);

  const a = await insertElement(page, 'rect');
  const b = await insertElement(page, 'button');

  await openContextMenu(page, a);
  await page.locator('.ctx-item.danger').click();

  await expect(page.getByTestId(`el-${a}`)).toHaveCount(0);
  await expect(page.getByTestId(`el-${b}`)).toBeVisible();
});

test('duplicate via context menu creates a new element next to the original', async ({ page }) => {
  await signIn(page, uniqueEmail('ctx-f'));
  await openNewProject(page);

  const a = await insertElement(page, 'button');
  const before = await page.locator('.el').count();

  await openContextMenu(page, a);
  await page.getByTestId('ctx-menu').getByText('Duplicate').click();

  await expect.poll(async () => page.locator('.el').count(), { timeout: 5_000 }).toBe(before + 1);
});

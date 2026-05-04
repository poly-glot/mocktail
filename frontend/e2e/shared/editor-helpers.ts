import { Page, expect, Locator } from '@playwright/test';

/**
 * Shared helpers for per-feature editor e2e tests.
 *
 * All tests here run against the Firebase emulator stack started by
 * scripts/e2e-up.sh (see e2e/mocktail.spec.ts for the full preconditions).
 */

export async function signIn(page: Page, email: string): Promise<void> {
  page.on('console', (msg) => console.log(`[page:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[page:error]', err.message));
  await page.goto('/login');
  await expect(page.getByTestId('login-google')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __mocktailTestLogin?: (e: string) => void })
        .__mocktailTestLogin === 'function',
    null,
    { timeout: 15_000 },
  );
  await page.evaluate(
    (e) =>
      (window as unknown as { __mocktailTestLogin: (e: string) => void }).__mocktailTestLogin(e),
    email,
  );
  await expect(page).toHaveURL(/\/t\//, { timeout: 20_000 });
}

export function uniqueEmail(suffix: string): string {
  return `user-${Date.now()}-${suffix}@test.mocktail`;
}

export async function openNewProject(page: Page): Promise<void> {
  await page.getByTestId('new-project').click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  await expect(page.locator('.page-tabs .page-tab.on')).toBeVisible({ timeout: 10_000 });
}

export async function openLayersPanel(page: Page): Promise<void> {
  await page.getByTestId('rail-symbols').click();
  await expect(page.getByTestId('layers-panel')).toBeVisible();
}

export async function insertElement(page: Page, type: string): Promise<string> {
  const beforeCount = await page.locator('.el').count();
  await page.getByTestId(`palette-${type}`).click();
  await expect.poll(async () => page.locator('.el').count()).toBe(beforeCount + 1);
  // Return the id of the newly selected element (the insert auto-selects it).
  const id = await page.evaluate(() => {
    const sel = document.querySelector('.el.selected');
    const testid = sel?.getAttribute('data-testid') ?? '';
    return testid.replace(/^el-/, '');
  });
  if (!id) throw new Error('inserted element had no id');
  return id;
}

export async function selectElementById(page: Page, id: string): Promise<void> {
  await page.getByTestId(`el-${id}`).click();
  await expect(page.locator(`.el.selected[data-testid="el-${id}"]`)).toBeVisible();
}

export async function elementBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; w: number; h: number; zIndex: number }> {
  return await page.evaluate((elId: string) => {
    const el = document.querySelector(`[data-testid="el-${elId}"]`) as HTMLElement | null;
    if (!el) throw new Error(`el-${elId} not found`);
    return {
      x: parseInt(el.style.left, 10),
      y: parseInt(el.style.top, 10),
      w: parseInt(el.style.width, 10),
      h: parseInt(el.style.height, 10),
      zIndex: parseInt(el.style.zIndex, 10),
    };
  }, id);
}

export async function openContextMenu(page: Page, id: string): Promise<Locator> {
  // Dispatch contextmenu directly on the target so stacked/overlapping elements
  // don't intercept the right-click (palette-inserts land at the same center).
  await page.getByTestId(`el-${id}`).dispatchEvent('contextmenu');
  const menu = page.getByTestId('ctx-menu');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  return menu;
}

export async function closeContextMenu(page: Page): Promise<void> {
  const overlay = page.getByTestId('ctx-overlay');
  if (await overlay.isVisible()) {
    await overlay.click();
  }
}

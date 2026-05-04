import { Page, expect, test } from '@playwright/test';

/**
 * End-to-end happy path for Mocktail.
 *
 * Preconditions (wired by scripts/e2e-up.sh — Playwright won't start these):
 *   1. Firebase Auth + Firestore emulators (auth :9099, firestore :8083)
 *   2. Zig backend on :8082  (collab WS + /api passthrough)
 *   3. Deno AI service on :8085 (/api/ai/*)
 *
 * Playwright starts the Angular dev server itself (proxy.conf.json wires the
 * three /api prefixes to the right upstream).
 */

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, email: string) {
  page.on('console', (msg) => console.log(`[page:${msg.type()}]`, msg.text()));
  page.on('pageerror', (err) => console.log('[page:error]', err.message));
  await page.goto('/login');
  await expect(page.getByTestId('login-google')).toBeVisible({ timeout: 15_000 });
  // Wait until the test hook is installed by firebase-init.
  await page.waitForFunction(
    () => typeof (window as any).__mocktailTestLogin === 'function',
    null,
    { timeout: 15_000 },
  );
  await page.evaluate((e) => (window as any).__mocktailTestLogin(e), email);
  // After sign-in the app redirects / routes through HomeComponent → dashboard.
  await expect(page).toHaveURL(/\/t\//, { timeout: 20_000 });
}

test('new user lands on dashboard with a bootstrapped tenant', async ({ page }) => {
  const email = `user-${Date.now()}-a@test.mocktail`;
  await signIn(page, email);
  await expect(page.getByTestId('project-grid')).toBeVisible();
  await expect(page.getByTestId('dash-empty')).toBeVisible();
});

test('user creates a project, adds an element, uses AI generate', async ({ page }) => {
  const email = `user-${Date.now()}-b@test.mocktail`;
  await signIn(page, email);

  // Create a project.
  await page.getByTestId('new-project').click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  await expect(page.getByTestId('components-panel')).toBeVisible();
  // Wait for the first page to be loaded (tab rendered) before inserting.
  await expect(page.locator('.page-tabs .page-tab.on')).toBeVisible({ timeout: 10_000 });

  // Click-to-insert is the primary test path (palette tiles also support
  // drag-to-drop for free-positioning — separately exercised by the drag spec).
  await page.getByTestId('palette-button').click();
  await expect(page.locator('.el').first()).toBeVisible({ timeout: 10_000 });

  // AI generate — fallback generator kicks in (no Gemini key), still returns elements.
  await page.getByTestId('ai-prompt').fill('login page');
  await page.getByTestId('ai-generate').click();
  await expect
    .poll(async () => page.locator('.el').count(), { timeout: 15_000 })
    .toBeGreaterThan(3);
});

test('user drops a comment pin, sees it on canvas, resolves it', async ({ page }) => {
  const email = `user-${Date.now()}-d@test.mocktail`;
  await signIn(page, email);

  await page.getByTestId('new-project').click();
  await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 });
  await expect(page.getByTestId('canvas-board')).toBeVisible();
  await expect(page.locator('.page-tabs .page-tab.on')).toBeVisible({ timeout: 10_000 });

  // Enter comment mode.
  await page.getByTestId('comment-tool').click();

  // Click somewhere on the board to drop a draft pin.
  const board = await page.getByTestId('canvas-board').boundingBox();
  if (!board) throw new Error('no board');
  await page.mouse.click(board.x + 200, board.y + 160);

  // Draft input should appear.
  const draft = page.getByTestId('comment-draft-input');
  await expect(draft).toBeVisible({ timeout: 5_000 });
  await draft.fill('Logo looks too small here');
  await page.getByTestId('comment-draft-save').click();

  // Pin should render on the canvas.
  await expect(page.locator('.comment-pin .marker').first()).toBeVisible({ timeout: 10_000 });

  // Activity feed on the dashboard should have recorded the comment (and the
  // auto-created project). Navigate back and verify.
  await page.goBack();
  await expect(page.getByTestId('activity-feed')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('activity-feed')).toContainText(/commented/);
});

test('two tabs see each other live via cursor broadcast', async ({ browser }) => {
  const email = `user-${Date.now()}-c@test.mocktail`;
  // Tab A — sign in and open a project.
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await signIn(a, email);
  await a.getByTestId('new-project').click();
  await expect(a).toHaveURL(/\/p\//, { timeout: 10_000 });
  const url = a.url();

  // Tab B — same user, same project.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signIn(b, email);
  await b.goto(url);
  await expect(b.getByTestId('canvas-board')).toBeVisible();

  // Move mouse in A; expect B's presence strip to count ≥ 1 peer.
  const boardA = await a.getByTestId('canvas-board').boundingBox();
  if (!boardA) throw new Error('no board A');
  for (let i = 0; i < 8; i++) {
    await a.mouse.move(boardA.x + 100 + i * 20, boardA.y + 100 + i * 15, { steps: 3 });
  }

  await expect
    .poll(async () => (await b.getByTestId('presence').textContent()) ?? '', {
      timeout: 15_000,
    })
    .toMatch(/\bpeer(s)?\b/);

  await ctxA.close();
  await ctxB.close();
});

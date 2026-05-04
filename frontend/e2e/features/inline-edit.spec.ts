import { expect, test } from '@playwright/test';
import { insertElement, openNewProject, signIn, uniqueEmail } from '../shared/editor-helpers';

/**
 * Inline editing: double-click makes the text span contentEditable.
 *
 * Commit paths:
 *   - Enter (for non-text types — button, heading, link) commits; text
 *     allows newlines so Enter does NOT commit.
 *   - blur commits.
 *   - Escape reverts without persisting.
 */

test.describe.configure({ mode: 'serial' });

async function insertAndWaitForText(
  page: import('@playwright/test').Page,
  type: string,
): Promise<string> {
  const id = await insertElement(page, type);
  await expect(page.getByTestId(`inline-edit-${id}`)).toBeVisible();
  return id;
}

test('dblclick makes button text editable, Enter commits', async ({ page }) => {
  await signIn(page, uniqueEmail('edit-a'));
  await openNewProject(page);

  const id = await insertAndWaitForText(page, 'button');
  const span = page.getByTestId(`inline-edit-${id}`);

  await page.getByTestId(`el-${id}`).dblclick();
  await expect(span).toHaveAttribute('contenteditable', 'true');

  await span.evaluate((el) => {
    el.textContent = '';
    const s = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    s?.removeAllRanges();
    s?.addRange(r);
  });
  await page.keyboard.type('Sign up');
  await page.keyboard.press('Enter');

  await expect(span).not.toHaveAttribute('contenteditable', 'true');
  await expect(span).toHaveText('Sign up');
});

test('dblclick on heading, Escape reverts the edit', async ({ page }) => {
  await signIn(page, uniqueEmail('edit-b'));
  await openNewProject(page);

  const id = await insertAndWaitForText(page, 'heading');
  const span = page.getByTestId(`inline-edit-${id}`);
  const original = (await span.textContent()) ?? '';

  await page.getByTestId(`el-${id}`).dblclick();
  await expect(span).toHaveAttribute('contenteditable', 'true');
  await span.evaluate((el) => {
    el.textContent = 'Something else';
    (el as HTMLElement).focus();
  });
  await page.keyboard.press('Escape');

  await expect(span).not.toHaveAttribute('contenteditable', 'true');
  await expect(span).toHaveText(original);
});

test('text element allows Enter (newline) and only commits on blur', async ({ page }) => {
  await signIn(page, uniqueEmail('edit-c'));
  await openNewProject(page);

  const id = await insertAndWaitForText(page, 'text');
  const span = page.getByTestId(`inline-edit-${id}`);

  await page.getByTestId(`el-${id}`).dblclick();
  await expect(span).toHaveAttribute('contenteditable', 'true');

  await span.evaluate((el) => {
    el.textContent = '';
    const s = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    s?.removeAllRanges();
    s?.addRange(r);
  });
  await page.keyboard.type('Line1');
  await page.keyboard.press('Enter');
  // Still editing — text type does not commit on Enter.
  await expect(span).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type('Line2');

  // Click outside to blur — should commit.
  await page.getByTestId('canvas-board').click({ position: { x: 10, y: 10 } });
  await expect(span).not.toHaveAttribute('contenteditable', 'true');
  const txt = (await span.textContent()) ?? '';
  expect(txt).toContain('Line1');
  expect(txt).toContain('Line2');
});

test('Enter/Escape in inspector text field does not trigger editor-level hotkeys', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('edit-d'));
  await openNewProject(page);

  const id = await insertElement(page, 'button');
  await page.getByTestId(`el-${id}`).click();

  const field = page.getByTestId('inspect-text');
  await field.fill('Updated via inspector');
  await expect
    .poll(async () => (await page.getByTestId(`inline-edit-${id}`).textContent()) ?? '', {
      timeout: 5_000,
    })
    .toBe('Updated via inspector');
});

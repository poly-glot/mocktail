import { expect, test } from '@playwright/test';
import {
  insertElement,
  openNewProject,
  selectElementById,
  signIn,
  uniqueEmail,
} from '../shared/editor-helpers';

/**
 * Image library: search, tile-click apply, inspector attribution, remove,
 * and canvas image-load error fallback. The `/api/images/*` network calls
 * are stubbed at the browser level so the test doesn't depend on Unsplash.
 */

test.describe.configure({ mode: 'serial' });

const STUB_RESULTS = [
  {
    id: 'abc',
    urls: {
      regular: 'https://example.test/abc-regular.jpg',
      small: 'https://example.test/abc-small.jpg',
      thumb: 'https://example.test/abc-thumb.jpg',
    },
    links: {
      download_location: 'https://api.unsplash.com/photos/abc/download',
      html: 'https://unsplash.com/photos/abc',
    },
    user: { name: 'Ansel Example', links: { html: 'https://unsplash.com/@ansel' } },
    width: 1920,
    height: 1080,
  },
];

async function stubImagesApi(
  page: import('@playwright/test').Page,
  results: typeof STUB_RESULTS = STUB_RESULTS,
  hasMore = false,
): Promise<void> {
  await page.route('**/api/images/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results, hasMore }),
    });
  });
  await page.route('**/api/images/track-download', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
}

test('image library: search → apply to selected image, shows attribution, remove reverts', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('images-a'));
  await openNewProject(page);

  await stubImagesApi(page);

  const id = await insertElement(page, 'image');
  await selectElementById(page, id);

  await page.getByTestId('rail-images').click();
  await expect(page.getByTestId('images-panel')).toBeVisible();

  await page.getByTestId('images-search').fill('mountain');
  const tile = page.getByTestId('images-tile-abc');
  await expect(tile).toBeVisible({ timeout: 5_000 });

  await tile.click();

  // Canvas image rendered from Unsplash src.
  const srcImg = page.getByTestId(`image-src-${id}`);
  await expect(srcImg).toBeVisible({ timeout: 5_000 });
  await expect(srcImg).toHaveAttribute('src', /abc-regular/);

  // Inspector attribution appears with credit block.
  await expect(page.getByTestId('image-credit')).toContainText('Ansel Example');
  await expect(page.getByTestId('image-credit')).toContainText('Unsplash');

  // Remove → reverts to placeholder.
  await page.getByTestId('image-remove').click();
  await expect(page.getByTestId(`image-src-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('image-empty-hint')).toBeVisible();
});

test('image library: replace from inspector opens the images panel', async ({ page }) => {
  await signIn(page, uniqueEmail('images-b'));
  await openNewProject(page);

  await stubImagesApi(page);

  const id = await insertElement(page, 'image');
  await selectElementById(page, id);

  // Start on components panel, then click Replace image in inspector.
  await expect(page.getByTestId('components-panel')).toBeVisible();
  await page.getByTestId('image-replace').click();
  await expect(page.getByTestId('images-panel')).toBeVisible();
});

test('image library: tile click is a no-op when a non-image element is selected', async ({
  page,
}) => {
  await signIn(page, uniqueEmail('images-c'));
  await openNewProject(page);

  await stubImagesApi(page);

  const rectId = await insertElement(page, 'rect');
  await selectElementById(page, rectId);

  await page.getByTestId('rail-images').click();
  await page.getByTestId('images-search').fill('cat');
  await expect(page.getByTestId('images-tile-abc')).toBeVisible({ timeout: 5_000 });

  // "Select an image element" hint is present when canApply is false.
  await expect(page.getByTestId('images-no-selection')).toBeVisible();

  await page.getByTestId('images-tile-abc').click();
  // Rect should not pick up an image-src node.
  await expect(page.getByTestId(`image-src-${rectId}`)).toHaveCount(0);
});

test('image library: canvas image load error reverts element to placeholder', async ({ page }) => {
  await signIn(page, uniqueEmail('images-d'));
  await openNewProject(page);

  // Search/download stubbed fine, but the actual image URL 404s so <img> errors.
  const broken = [
    {
      ...STUB_RESULTS[0],
      urls: {
        regular: 'https://example.test/definitely-broken.jpg',
        small: 'https://example.test/definitely-broken-s.jpg',
        thumb: 'https://example.test/definitely-broken-t.jpg',
      },
    },
  ];
  await stubImagesApi(page, broken);
  await page.route('https://example.test/**', async (route) => {
    await route.fulfill({ status: 404, body: '' });
  });

  const id = await insertElement(page, 'image');
  await selectElementById(page, id);

  await page.getByTestId('rail-images').click();
  await page.getByTestId('images-search').fill('broken');
  await page.getByTestId('images-tile-abc').click();

  // Element reverts: no image-src, back to placeholder hint.
  await expect(page.getByTestId(`image-src-${id}`)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('image-empty-hint')).toBeVisible();
});

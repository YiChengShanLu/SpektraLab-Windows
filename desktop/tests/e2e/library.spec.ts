import { expect, test } from '@playwright/test';

test('library entry reports unavailable SDK in browser and keeps editor shortcuts isolated', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.getByTestId('library-button').click();
  const library = page.getByTestId('library-page');
  await expect(library).toBeVisible();
  await expect(library.getByRole('alert')).toContainText('Windows');
  await expect(library.getByRole('button', { name: 'New library / session' })).toBeDisabled();
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('export-page')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(library).not.toBeVisible();
});

test('library collection, selection and variant controls remain usable at desktop window sizes', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.evaluate(() => {
    const { libraryStore } = (window as unknown as { __spk: { libraryStore: { setState(patch: object): void } } }).__spk;
    libraryStore.setState({ visible: true, initialized: true, available: true, library: 'L1', sdk: '0.3.1',
      info: { name: '新疆旅行', path: 'E:/中文图库.spkcatalog', kind: 'catalog', origin: { kind: 'none' }, counts: { images: 160 } },
      collections: [{ uuid: 'album', title: '精选照片', name: '精选照片', kind: 'album', parent: null, editable: true, supported: true, image_count: 1 }],
      total: 160, images: Array.from({ length: 80 }, (_, index) => ({ uuid: `image${index}`, file_name: `新疆${index}.ARW`, path: `K:/新疆${index}.ARW`, kind: 'raw', exists: false,
        exposure: { aperture: 7.099999904632568, shutter: .005, focal_length: 30 },
        variants: [{ uuid: 'v1', position: 1, rating: 4, color_tag: 1 }, { uuid: 'v2', position: 2, rating: 5, color_tag: 2 }] })),
    });
  });
  const library = page.getByTestId('library-page');
  await library.getByRole('button', { name: 'Select 新疆0.ARW', exact: true }).click();
  await expect(library.locator('.library-exif')).toContainText('f/7.1');
  await expect(library.locator('.library-exif')).toContainText('1/200 s');
  expect((await library.locator('.library-card').first().boundingBox())!.height).toBeGreaterThan(180);
  expect((await library.locator('.library-original').first().boundingBox())!.height).toBeGreaterThan(120);
  await expect(library.getByRole('button', { name: 'Edit 1 selected', exact: true })).toBeDisabled();
  await expect(library.getByRole('button', { name: 'Duplicate variant', exact: true })).toBeVisible();
  await library.getByRole('combobox', { name: 'Active variant', exact: true }).selectOption('v2');
  await expect(library.getByRole('combobox', { name: 'Active variant', exact: true })).toHaveValue('v2');
  const size = library.getByRole('slider', { name: 'Thumbnail size', exact: true });
  await size.fill('230');
  await expect(library.locator('.library-original').first()).toHaveCSS('height', '230px');
  expect(await page.evaluate(() => localStorage.getItem('store:Library/thumbnail-size.json'))).toBe('230');
  await library.getByRole('button', { name: 'Select 新疆0.ARW', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(library.getByRole('button', { name: 'Select 新疆1.ARW', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+a');
  expect(await library.locator('.library-card.selected').count()).toBe(80);
  await library.getByRole('button', { name: 'Select 新疆1.ARW', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copy file path', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Show in Explorer', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  for (const width of [1600, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(library.getByRole('button', { name: 'Duplicate variant', exact: true })).toBeVisible();
  }
  await library.getByRole('button', { name: 'New library / session' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('新建图库');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

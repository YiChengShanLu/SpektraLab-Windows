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
  await library.getByRole('button', { name: 'Select page', exact: true }).click();
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

test('all-selection covers every page, obeys filters, survives browsing and trashes/restores only records', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.evaluate(() => {
    const images = Array.from({ length: 205 }, (_, index) => ({ uuid: `image${index}`, file_name: `Photo ${index}.ARW`, path: `/owned/${index}.ARW`,
      kind: 'raw', exists: false, rating: 0, color_tag: 0, trashed: false,
      variants: [{ uuid: `v${index}`, position: 1, rating: 0, color_tag: 0, edit_revision: 0, origin: 'local' }] }));
    const info = { uuid: 'L1', name: 'Owned fixture', path: '/owned/catalog', kind: 'catalog', origin: { kind: 'none' }, counts: { images: images.length } };
    const collections = [{ uuid: 'trash', name: 'Trash', title: 'Trash', kind: 'trash', image_count: 0 }];
    const w = window as unknown as { __spk: { libraryStore: { setState(patch: object): void } }; __TAURI_INTERNALS__: { invoke(command: string, args: { method: string; params: { offset?: number; limit?: number; filter?: { text?: string }; include_trashed?: boolean; images?: string[]; trashed?: boolean } }): Promise<unknown> } };
    w.__spk.libraryStore.setState({ visible: true, initialized: true, available: true, library: 'L1', sdk: '0.3.1', info, collections, images: images.slice(0, 80), total: images.length });
    // The browser host/platform are initialized above. Only this fixture's SDK
    // calls use a test IPC bridge; no actual photo, catalog or native filesystem.
    w.__TAURI_INTERNALS__ = { invoke: async (command, { method, params: p }) => {
      if (command !== 'library_request') throw new Error(`Unexpected native call: ${command}`);
      if (method === 'images.list') {
        const rows = images.filter((image) => (p.include_trashed ? image.trashed : !image.trashed) && (!p.filter?.text || image.file_name.includes(p.filter.text)));
        const offset = p.offset ?? 0; return { images: rows.slice(offset, offset + (p.limit ?? 80)), total: rows.length, offset };
      }
      if (method === 'images.trash') { for (const image of images) if (p.images?.includes(image.uuid)) image.trashed = p.trashed!; return {}; }
      if (method === 'library.info') return info;
      if (method === 'collections.list') return { collections: collections.map((c) => ({ ...c, image_count: images.filter((image) => image.trashed).length })) };
      if (method === 'folders.list') return { folders: [] };
      if (method === 'locations.list') return { locations: [] };
      if (method === 'images.facets') return {};
      throw new Error(`Unexpected SDK mutation: ${method}`);
    } };
  });
  const library = page.getByTestId('library-page'), count = library.getByTestId('library-selection-count');
  await library.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(count).toContainText('205 selected');
  await expect(library.locator('.library-card')).toHaveCount(80);
  await library.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(library.getByRole('button', { name: 'Select Photo 80.ARW', exact: true })).toBeVisible();
  await expect(count).toContainText('205 selected');
  await expect(library.locator('.library-card.selected')).toHaveCount(80);
  await library.getByRole('checkbox', { name: 'Add Photo 80.ARW to selection', exact: true }).uncheck();
  await expect(count).toContainText('204 selected');
  await library.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(count).toContainText('0 selected');
  await library.getByRole('button', { name: 'Select Photo 80.ARW', exact: true }).focus();
  await page.keyboard.press('Control+a');
  await expect(count).toContainText('205 selected');
  const search = library.getByRole('textbox', { name: 'Search filenames' });
  await search.fill('200.ARW');
  await expect(count).toContainText('0 selected');
  await expect(library.locator('.library-card')).toHaveCount(1);
  await search.press('Control+a');
  await expect(count).toContainText('0 selected');
  await library.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(count).toContainText('1 selected');
  await search.fill('');
  await expect(library.locator('.library-card')).toHaveCount(80);
  await library.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(count).toContainText('205 selected');
  await library.getByRole('button', { name: 'Hide in library trash', exact: true }).click();
  await expect(library.locator('.library-card')).toHaveCount(0);
  await expect(count).toContainText('0 selected');
  await library.getByRole('button', { name: 'Trash 205', exact: true }).click();
  await expect(library.locator('.library-card')).toHaveCount(80);
  await library.getByRole('button', { name: 'Select all results', exact: true }).click();
  await expect(count).toContainText('205 selected');
  await library.getByRole('button', { name: 'Restore from trash', exact: true }).click();
  await expect(library.locator('.library-card')).toHaveCount(0);
  await expect(count).toContainText('0 selected');
});

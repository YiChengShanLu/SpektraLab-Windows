import { expect, test } from '@playwright/test';

test('export grid keeps the batch while browsing and persists its layout', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('export-page')).toBeVisible();
  await page.getByTestId('export-grid-mode').click();
  const grid = page.getByTestId('export-grid');
  await expect(grid.locator('[data-export-path]')).toHaveCount(8);
  await expect(grid.locator('canvas').first()).toBeVisible();
  const second = grid.locator('[data-export-path]').nth(1);
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(grid.locator('[data-export-path]')).toHaveCount(8);
  await second.focus();
  await page.keyboard.press('Enter');
  await expect(second).toBeFocused();
  await page.getByRole('slider', { name: 'Grid columns' }).fill('4');
  await expect(grid).toHaveCSS('grid-template-columns', /\S+ \S+ \S+ \S+/);
  await page.getByTestId('export-viewer-mode').click();
  await expect(page.getByTestId('export-proof')).toBeVisible();
  await page.getByTestId('export-grid-mode').click();
  await page.reload();
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.keyboard.press('Control+e');
  await expect(page.getByTestId('export-grid')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Grid columns' })).toHaveValue('4');
});

test('the export grid agrees with the filmstrip for a cropped, quarter-turned frame', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.evaluate(() => {
    const store = (window as unknown as { __spk: { sessionStore: { getState(): { sidecar: { geometry: object } }; setState(patch: object): void } } }).__spk.sessionStore;
    const state = store.getState();
    store.setState({ sidecar: { ...state.sidecar, geometry: { ...state.sidecar.geometry,
      crop: { x: .2, y: .1, width: .5, height: .6 }, quarterTurns: 1, flipH: true } } });
  });
  await page.getByTestId('export-button').click();
  await page.getByTestId('export-grid-mode').click();
  const picture = page.getByTestId('export-grid').locator('canvas').first();
  await expect(picture).toBeVisible();
  // A coordinate gradient is an image-space oracle. The mock's buildings
  // contain one-pixel stripes that alias differently at the two cell sizes.
  await page.evaluate(async () => {
    // Use the mounted editor's cache. Importing its unversioned Vite URL after
    // HMR can create a second module instance that the mounted UI never reads.
    const { thumbs, sessionStore: store }=(window as unknown as { __spk: {
      thumbs: { setPrint(path: string, url: string, filmCanvas: boolean): void };
      sessionStore: { getState(): { selection: string } };
    } }).__spk;
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
    const context=canvas.getContext('2d')!;const image=context.createImageData(120,80);
    for(let y=0;y<80;y++)for(let x=0;x<120;x++) {
      const i=(y*120+x)*4;image.data.set([x*2,y*3,80,255],i);
    }
    context.putImageData(image,0,0);
    const blob=await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    thumbs.setPrint(store.getState().selection,URL.createObjectURL(blob),false);
  });
  const readSamples = () => page.evaluate(() => {
    const sample = (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!;
      // The two cells use different raster sizes. Compare the same normalized
      // regions, not isolated samples that can land on opposite sides of a line.
      return { ratio: canvas.width / canvas.height, pixels: [[.1,.15],[.5,.5],[.85,.8]].flatMap(([x,y]) => {
        const pixels = context.getImageData(Math.floor((x!-.04)*canvas.width), Math.floor((y!-.04)*canvas.height),
          Math.max(1, Math.round(.08*canvas.width)), Math.max(1, Math.round(.08*canvas.height))).data;
        return [0,1,2,3].map((channel) => {
          let sum=0; for(let i=channel;i<pixels.length;i+=4)sum+=pixels[i]!;
          return sum/(pixels.length/4);
        });
      }) };
    };
    return { grid: sample(document.querySelector('[data-testid=export-grid] canvas')!),
      strip: sample(document.querySelector('.thumb.open canvas')!) };
  });
  const samples = await readSamples();
  expect(samples.grid.ratio).toBeLessThan(1);
  expect(Math.abs(samples.grid.ratio - samples.strip.ratio)).toBeLessThan(.02);
  await expect.poll(async () => {
    const value=await readSamples();
    if(Math.abs(value.grid.pixels[6]!-80)>3)return Infinity;
    return Math.max(...value.grid.pixels.map((channel,i) => Math.abs(channel-value.strip.pixels[i]!)));
  }).toBeLessThanOrEqual(5);
});

test('memory budget and RAW cache controls save and remain separate from display-cache controls', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await expect(page.getByLabel('Memory reserve', { exact: true })).toHaveValue('1024');
  await page.getByLabel('Memory reserve', { exact: true }).fill('512');
  await page.getByLabel('RAW cache limit', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Apply budget and RAW cache', exact: true }).click();
  await page.getByRole('button', { name: 'Clear RAW cache', exact: true }).click();
  await expect(page.getByLabel('Memory reserve', { exact: true })).toHaveValue('512');
  await expect(page.getByLabel('RAW cache limit', { exact: true })).toHaveValue('4');
  await expect(page.getByRole('heading', { name: 'Display cache on disk', exact: true })).toBeVisible();
});

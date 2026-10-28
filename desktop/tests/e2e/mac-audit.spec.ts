import { expect, test, type Page } from '@playwright/test';

const state = (page: Page, expression: string) => page.evaluate((e) => {
  const app = (window as unknown as { __spk: { sessionStore: { getState(): unknown }; frameImages: unknown } }).__spk;
  return new Function('s', 'images', `return ${e}`)(app.sessionStore.getState(), app.frameImages);
}, expression);
async function postDev(page: Page) {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.getByRole('tab', { name: 'Post-Dev', exact: true }).click();
}

test('RAW decode policy survives reload, undoes, and keeps the current original in sync', async ({ page }) => {
  await page.goto('/?open=&fresh=1');
  await expect.poll(() => state(page, '!!images.original && !s.developing')).toBe(true);
  const decode = page.getByTestId('raw-decode-mode');
  await expect(decode).toHaveText('Auto · expanded linear');
  const initial = await state(page, 's.undo.length');
  await decode.click();
  await page.getByRole('menuitem', { name: 'Compatible 16-bit', exact: true }).click();
  await expect.poll(() => state(page, 's.sidecar.decode.rawMode')).toBe('compatible16');
  await expect.poll(() => state(page, '!!images.original && !s.developing')).toBe(true);
  expect(await state(page, 's.undo.length')).toBe(initial + 1);
  await page.keyboard.press('Control+z');
  await expect(decode).toHaveText('Auto · expanded linear');
  await decode.click();
  await page.getByRole('menuitem', { name: 'Expanded linear (Bayer)', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sidecar:/mock/Roll 01/DSC_0001.NEF')?.includes('"rawMode":"headroom"'))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('raw-decode-mode')).toHaveText('Expanded linear (Bayer)');
  await expect.poll(() => state(page, '!!images.original && !s.developing')).toBe(true);
});

test('a fresh photograph stays on its decoded source until edited and restores the developed result after reload', async ({ page }) => {
  await page.goto('/?open=&fresh=1');
  await expect.poll(() => state(page, '!!images.original && !s.developing')).toBe(true);
  expect(await state(page, 's.sidecar.state')).toBe('unprocessed');
  expect(await state(page, 'images.print')).toBeNull();
  await expect(page.getByTestId('camera-preview-badge')).toContainText('choose Solve');
  await page.locator('[data-stock="kodak_gold_200"]').click();
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  expect(await state(page, 's.sidecar.state')).toBe('processed');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sidecar:/mock/Roll 01/DSC_0001.NEF')?.includes('kodak_gold_200'))).toBe(true);
  await page.reload();
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  expect(await state(page, 's.sidecar.params.filmStock')).toBe('kodak_gold_200');
});

test('three-way wheels fit the rail, preserve other zones, and a long drag undoes in one step', async ({ page }) => {
  await postDev(page);
  await page.getByRole('tab', { name: '3-Way', exact: true }).click();
  const three = page.getByTestId('colorbalance-three-way');
  await three.scrollIntoViewIfNeeded();
  await expect(three.locator('svg')).toHaveCount(3);
  const before = await state(page, '({selection:s.selection, undo:s.undo.length, balance:s.sidecar.adjustments.colorBalance})');
  const wheel = three.locator('svg').nth(1);
  let box = (await wheel.boundingBox())!;
  const p = (x: number, y: number) => ({ x: box.x + (x + 64) / 128 * box.width, y: box.y + (64 - y) / 128 * box.height });
  await page.mouse.move(p(10, 0).x, p(10, 0).y); await page.mouse.down();
  await page.mouse.move(p(20, 10).x, p(20, 10).y);
  await page.waitForTimeout(650); // Exceeds the old 500 ms undo coalescing window.
  await page.mouse.move(p(25, 10).x, p(25, 10).y); await page.mouse.up();
  expect(await state(page, 's.undo.length')).toBe(before.undo + 1);
  expect(await state(page, 's.sidecar.adjustments.colorBalance.midtones')).toEqual(before.balance.midtones);
  expect((await state(page, 's.sidecar.adjustments.colorBalance.shadows')).saturation).toBeGreaterThan(.5);
  await page.keyboard.press('Control+z');
  expect(await state(page, 's.sidecar.adjustments.colorBalance')).toEqual(before.balance);
  const sat = three.getByRole('slider', { name: 'Shadow Saturation', exact: true });
  await sat.focus(); await page.keyboard.press('End');
  expect(await state(page, 's.sidecar.adjustments.colorBalance.shadows.saturation')).toBe(1);
  await page.keyboard.press('ArrowLeft');
  expect(await state(page, 's.selection')).toBe(before.selection);
  expect(await state(page, 's.sidecar.adjustments.colorBalance.shadows.saturation')).toBeCloseTo(.99);
  // Lower-left arc endpoint crosses atan2's negative-angle seam.
  await wheel.scrollIntoViewIfNeeded();
  box = (await wheel.boundingBox())!;
  const low = p(51 * Math.cos(245 * Math.PI / 180), 51 * Math.sin(245 * Math.PI / 180));
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="slider"]')?.getAttribute('aria-label'), low)).toBe('Shadow Saturation');
  await page.mouse.click(low.x, low.y);
  expect(await state(page, 's.sidecar.adjustments.colorBalance.shadows.saturation')).toBeCloseTo(0, 2);
  const luminance = three.getByRole('slider', { name: 'Shadow Luminance', exact: true });
  await luminance.focus(); await page.keyboard.press('End');
  const priorReset = await state(page, 's.sidecar.adjustments.colorBalance.shadows');
  await wheel.getByRole('slider', { name: 'Shadow Hue and saturation', exact: true }).dblclick();
  expect(await state(page, 's.sidecar.adjustments.colorBalance.shadows')).toEqual({ hue: 0, saturation: 0, luminance: 0 });
  await page.keyboard.press('Control+z');
  expect(await state(page, 's.sidecar.adjustments.colorBalance.shadows')).toEqual(priorReset);
  for (const width of [1600, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await three.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('three-way.png') });
});

test('curve context deletion, protected endpoints, double-click reset and undo match Mac interactions', async ({ page }) => {
  await postDev(page);
  const curve = page.getByTestId('curve-editor');
  await curve.scrollIntoViewIfNeeded();
  let box = (await curve.boundingBox())!;
  await page.mouse.click(box.x + box.width * .45, box.y + box.height * .35);
  expect(await state(page, 's.sidecar.adjustments.curves.rgb.points.length')).toBe(3);
  await page.mouse.click(box.x + box.width * .45, box.y + box.height * .35, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete control point', exact: true }).click();
  expect(await state(page, 's.sidecar.adjustments.curves.rgb.points.length')).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await state(page, 's.sidecar.adjustments.curves.rgb.points.length')).toBe(3);
  box = (await curve.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + box.height - 2, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Delete control point', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await curve.dblclick({ position: { x: box.width * .7, y: box.height * .3 } });
  expect(await state(page, 's.sidecar.adjustments.curves.rgb.points')).toEqual([[0, 0], [1, 1]]);
  await page.keyboard.press('Control+z');
  expect(await state(page, 's.sidecar.adjustments.curves.rgb.points.length')).toBe(3);
});

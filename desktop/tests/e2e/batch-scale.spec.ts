import { expect, test } from '@playwright/test';

test('a 2844-frame RAW roll keeps thumbnails bounded while browsing and preserves selection at the far end', async ({ page }) => {
  await page.goto('/?open=');
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  const metrics = await page.evaluate(async () => {
    const app = (window as unknown as { __spk: { sessionStore: {
      getState(): { frames: { path: string; name: string }[] }; setState(patch: object): void;
    }; thumbs: { get(path: string): string | null } } }).__spk;
    const first = app.sessionStore.getState().frames[0]!;
    const frames = Array.from({ length: 2844 }, (_, i) => i === 0 ? first : { ...first, name: `RAW_${i}.ARW`, path: `/scale/RAW_${i}.ARW` });
    const started = performance.now();
    app.sessionStore.setState({ frames, picked: frames.map(f => f.path) });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { mountMs: performance.now() - started };
  });
  await expect(page.locator('.filmstrip .thumb')).toHaveCount(2844);
  const subscriptionCount = () => page.evaluate(() => {
    const cells = document.querySelectorAll('.filmstrip .thumb');
    return Array.from(cells).filter(cell => cell.querySelector('canvas,.placeholder')).length;
  });
  await expect.poll(subscriptionCount).toBeLessThan(40);
  const mountedCounts = [await subscriptionCount()];
  const strip = page.locator('.filmstrip-cells');
  for (const position of [.2, .4, .6, .8, 1]) {
    await strip.evaluate((el, fraction) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * fraction; }, position);
    await expect.poll(subscriptionCount).toBeLessThan(40);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    mountedCounts.push(await subscriptionCount());
  }
  await page.locator('.filmstrip .thumb').last().click();
  await expect(page.locator('.filmstrip .thumb').last()).toHaveClass(/open/);
  await page.evaluate(async () => {
    const path = '/src/state/session.ts';
    const loaded = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)?.name ?? path;
    const { setAdjustments } = await import(loaded);
    setAdjustments((a: object) => ({ ...a, exposure: .25 }));
  });
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await expect.poll(subscriptionCount).toBeLessThan(40);
  await test.info().attach('scale-metrics', { body: JSON.stringify({ ...metrics, frames: 2844, mountedCounts }), contentType: 'application/json' });
});

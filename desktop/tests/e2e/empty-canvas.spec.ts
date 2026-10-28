import { expect, test } from '@playwright/test';

for (const folder of [true, false]) {
  test(`empty canvas opens ${folder ? 'a folder' : 'individual photographs'} directly`, async ({ page }) => {
    await page.goto('/');
    const empty = page.getByTestId('canvas-empty');
    await expect(empty).toBeVisible();
    await expect(page.locator('.thumb')).toHaveCount(0);
    const open = empty.getByRole('button', { name: folder ? 'Open folder…' : 'Open photographs…', exact: true });
    await expect(open).toBeEnabled();
    if (folder) await open.click();
    else await open.press('Space');
    await expect(page.locator('.thumb')).toHaveCount(folder ? 8 : 3);
    await expect(empty).toHaveCount(0);
    await expect(page.getByTestId('tier-badge')).toHaveText('full');
  });
}

test('toolbar defaults to photographs and offers a separate folder command', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-button').click();
  await expect(page.locator('.thumb')).toHaveCount(3);
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
  await page.getByTestId('open-options').click();
  await page.getByRole('menuitem', { name: /Open folder/ }).click();
  await expect(page.locator('.thumb')).toHaveCount(8);
  await expect(page.getByTestId('tier-badge')).toHaveText('full');
});

test('Ctrl+O opens photos and Ctrl+Shift+O opens a folder', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('open-button')).toBeEnabled();
  await page.keyboard.press('Control+o');
  await expect(page.locator('.thumb')).toHaveCount(3);
  await page.keyboard.press('Control+Shift+o');
  await expect(page.locator('.thumb')).toHaveCount(8);
});

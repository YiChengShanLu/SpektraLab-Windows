import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Menu } from '@tauri-apps/api/menu';
const fake = vi.hoisted(() => ({
  listener: null as unknown as (event: { preventDefault(): void }) => Promise<void>,
  flush: vi.fn(), unsaved: false, state: { batchExporting: false, externalEditConflict: false },
  library: { busy: '' }, message: vi.fn(), end: vi.fn(),
  maximized: false, bounds: { width: 1600, height: 900 }, resize: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
  onCloseRequested: async (cb: typeof fake.listener) => { fake.listener = cb; return vi.fn(); },
  isMaximized: async () => fake.maximized, isFullscreen: async () => false,
  innerSize: async () => ({ ...fake.bounds }), setSize: fake.resize,
}) }));
vi.mock('../platform', () => ({ platform: () => ({ message: fake.message }) }));
vi.mock('../i18n', () => ({ tz: (en: string) => en }));
vi.mock('../library/model', () => ({ libraryStore: { getState: () => fake.library } }));
vi.mock('../state/session', () => ({ flushSave: fake.flush, hasUnsavedEdits: () => fake.unsaved,
  endGesture: fake.end, sessionStore: { getState: () => fake.state } }));
import { installCloseGuard, replaceAppMenu } from './lifecycle';

beforeEach(async () => {
  vi.clearAllMocks(); fake.flush.mockResolvedValue(undefined); fake.message.mockResolvedValue(undefined);
  fake.unsaved = false; fake.state = { batchExporting: false, externalEditConflict: false }; fake.library.busy = '';
  fake.maximized = false; fake.bounds = { width: 1600, height: 900 };
  fake.resize.mockImplementation(async (size) => { fake.bounds = size; });
  vi.stubGlobal('navigator', { userAgent: 'Windows' });
  await installCloseGuard();
});
afterEach(() => vi.unstubAllGlobals());
it('preserves the restored client size when the first Windows menu consumes its row', async () => {
  const menu = { setAsAppMenu: async () => { fake.bounds.height -= 20; return null; } } as unknown as Menu;
  await replaceAppMenu(menu);
  expect(fake.bounds).toEqual({ width: 1600, height: 900 });
});
it('releases replaced menus and leaves maximized geometry alone', async () => {
  const previous = { close: vi.fn() };
  const menu = { setAsAppMenu: async () => previous } as unknown as Menu;
  await replaceAppMenu(menu);
  expect(previous.close).toHaveBeenCalledOnce(); expect(fake.resize).not.toHaveBeenCalled();
  fake.maximized = true;
  await replaceAppMenu({ setAsAppMenu: async () => null } as unknown as Menu);
  expect(fake.resize).not.toHaveBeenCalled();
});
it('waits for the final save and rejects overlapping close requests', async () => {
  let finish!: () => void;
  fake.flush.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = { preventDefault: vi.fn() }, second = { preventDefault: vi.fn() };
  let done = false;
  const saving = fake.listener(first).then(() => { done = true; });
  expect(fake.end).toHaveBeenCalledOnce(); expect(done).toBe(false);
  await fake.listener(second); expect(second.preventDefault).toHaveBeenCalledOnce();
  finish(); await saving;
  expect(done).toBe(true); expect(first.preventDefault).not.toHaveBeenCalled();
  expect(fake.flush).toHaveBeenCalledOnce();
});
it.each(['save failure', 'external conflict', 'export', 'library'])('keeps the window open for %s', async (reason) => {
  fake.unsaved = reason === 'save failure'; fake.state.externalEditConflict = reason === 'external conflict';
  fake.state.batchExporting = reason === 'export'; fake.library.busy = reason === 'library' ? 'Importing' : '';
  const event = { preventDefault: vi.fn() };
  await fake.listener(event);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(fake.message).toHaveBeenCalledOnce();
  if (reason === 'export' || reason === 'library') expect(fake.flush).not.toHaveBeenCalled();
  // Once the problem is resolved, a later ordinary close is allowed.
  fake.unsaved = false; fake.state.externalEditConflict = false; fake.state.batchExporting = false; fake.library.busy = '';
  const next = { preventDefault: vi.fn() }; await fake.listener(next);
  expect(next.preventDefault).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from 'vitest';
import type { LibraryBinding } from './edits';
import type { LibraryImage } from './client';
const fake = vi.hoisted(() => ({
  call: vi.fn(), open: vi.fn(), bindings: {} as Record<string, LibraryBinding>,
  session: { selection: null as string | null, frames: [] as { path: string }[], picked: [] as string[], batchExporting: false, externalEditConflict: false, lastError: null },
}));
vi.mock('./client', () => ({ libraryCall: fake.call, recycleLibraryTrash: vi.fn() }));
vi.mock('../state/session', () => ({ sessionStore: { getState: () => fake.session, setState: (patch: object) => Object.assign(fake.session, patch) },
  flushSave: async () => {}, hasUnsavedEdits: () => false, closeLibraryEditor: async () => {}, openPaths: fake.open }));
vi.mock('./edits', () => ({ libraryBinding: (path: string) => fake.bindings[path] }));
vi.mock('./thumbnails', () => ({ libraryThumbs: { reset: vi.fn() } }));
import { editLibraryPhotos, libraryStore } from './model';
beforeEach(() => {
  vi.resetAllMocks(); fake.bindings = {};
  Object.assign(fake.session, { selection: null, frames: [], picked: [], batchExporting: false, externalEditConflict: false, lastError: null });
  libraryStore.setState({ library: 'W1', visible: true, busy: '', images: [], collections: [], selected: [], variants: {},
    filter: { min_rating: 3 }, sort: 'date', descending: true, collection: 'album', offset: 0 });
  fake.open.mockImplementation(async (paths: string[], bindings: Record<string, LibraryBinding>, selecting?: string) => {
    fake.bindings = bindings; Object.assign(fake.session, { frames: paths.map((path) => ({ path })), selection: selecting ?? paths[0] });
  });
});
it('opens the complete filtered library across pages, skips offline media, and focuses the double-clicked variant', async () => {
  const images: LibraryImage[] = Array.from({ length: 502 }, (_, index) => ({ uuid: String(index), path: `/owned/${index}.ARW`, file_name: `${index}.ARW`,
    kind: index === 0 ? 'video' : 'raw', exists: index !== 1, rating: 3, color_tag: 0, trashed: false,
    variants: [{ uuid: `v${index}`, position: 1, rating: 3, color_tag: 0, edit_revision: 0, origin: 'local' }] }));
  fake.call.mockImplementation(async (_method: string, p: { offset: number; limit: number }) => ({ images: images.slice(p.offset, p.offset + p.limit), total: images.length, offset: p.offset }));
  await editLibraryPhotos([images[501]!], images[501]);
  expect(fake.call).toHaveBeenCalledTimes(2);
  expect(fake.call).toHaveBeenNthCalledWith(2, 'images.list', expect.objectContaining({ library: 'W1', offset: 500, limit: 500, collection: 'album', filter: { min_rating: 3 }, sort: 'date', descending: true }));
  expect(fake.session.frames).toHaveLength(500);
  expect(fake.session.selection).toBe('/owned/501.ARW');
  expect(fake.session.picked).toEqual(['/owned/501.ARW']);
  expect(fake.bindings['/owned/501.ARW']).toMatchObject({ variant: 'v501' });
  expect(libraryStore.getState()).toMatchObject({ visible: false, error: '' });
});

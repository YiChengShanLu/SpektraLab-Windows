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
import { clearLibrarySelection, editLibraryPhotos, libraryStore, loadLibraryPage, selectAllLibraryImages, selectedLibraryImages, selectLibraryImage, setLibraryQuery, trashLibraryPhotos } from './model';
beforeEach(() => {
  vi.resetAllMocks(); fake.bindings = {};
  Object.assign(fake.session, { selection: null, frames: [], picked: [], batchExporting: false, externalEditConflict: false, lastError: null });
  libraryStore.setState({ library: 'W1', visible: true, busy: '', loading: false, images: [], collections: [], selected: [], selectionImages: [], variants: {},
    filter: { min_rating: 3 }, sort: 'date', descending: true, collection: 'album', offset: 0 });
  fake.open.mockImplementation(async (paths: string[], bindings: Record<string, LibraryBinding>, selecting?: string) => {
    fake.bindings = bindings; Object.assign(fake.session, { frames: paths.map((path) => ({ path })), selection: selecting ?? paths[0] });
  });
});

function photographs(count: number): LibraryImage[] {
  return Array.from({ length: count }, (_, index) => ({ uuid: String(index), path: `/owned/${index}.ARW`, file_name: `${index}.ARW`,
    kind: 'raw', exists: true, rating: 3, color_tag: 0, trashed: false,
    variants: [{ uuid: `v${index}`, position: 1, rating: 3, color_tag: 0, edit_revision: 0, origin: 'local' }] }));
}
function catalog(images: LibraryImage[]) {
  fake.call.mockImplementation(async (method: string, p: { offset?: number; limit?: number; filter?: { text?: string }; include_trashed?: boolean; images?: string[]; trashed?: boolean }) => {
    if (method === 'images.list') {
      const rows = images.filter((image) => (p.include_trashed ? image.trashed : !image.trashed) && (!p.filter?.text || image.file_name.includes(p.filter.text)));
      const offset = p.offset ?? 0;
      return { images: rows.slice(offset, offset + (p.limit ?? 80)), total: rows.length, offset };
    }
    if (method === 'images.trash') { for (const image of images) if (p.images?.includes(image.uuid)) image.trashed = p.trashed!; return {}; }
    if (method === 'images.facets') return {};
    if (method === 'library.info') return { counts: { images: images.length } };
    if (method === 'collections.list') return { collections: [{ uuid: 'trash', kind: 'trash' }] };
    if (method === 'folders.list') return { folders: [] };
    if (method === 'locations.list') return { locations: [] };
    throw new Error(`Unexpected SDK call: ${method}`);
  });
  libraryStore.setState({ images: images.slice(0, 80), total: images.length });
}
it('selects all 5440 query results without decoding RAW, keeps selection across pages, and permits deselection', async () => {
  catalog(photographs(5440));
  await selectAllLibraryImages();
  expect(libraryStore.getState().selected).toHaveLength(5440);
  expect(libraryStore.getState().images).toHaveLength(80);
  expect(fake.call).toHaveBeenCalledTimes(11);
  expect(fake.call).toHaveBeenLastCalledWith('images.list', expect.objectContaining({ collection: 'album', filter: { min_rating: 3 }, offset: 5000, limit: 500, full: true, check_files: false }));
  setLibraryQuery({ offset: 80 });
  await vi.waitFor(() => expect(libraryStore.getState().loading).toBe(false));
  expect(libraryStore.getState().selected).toHaveLength(5440);
  expect(selectedLibraryImages()).toHaveLength(5440);
  selectLibraryImage('81', true);
  expect(libraryStore.getState().selected).toHaveLength(5439);
  expect(libraryStore.getState().selected).not.toContain('81');
  clearLibrarySelection();
  expect(selectedLibraryImages()).toEqual([]);
  expect(libraryStore.getState().selectionImages).toEqual([]);
});
it('trashes and restores all pages of records while preserving their source paths', async () => {
  const images = photographs(165), paths = images.map((image) => image.path);
  catalog(images);
  await selectAllLibraryImages();
  await trashLibraryPhotos(true);
  expect(fake.call).toHaveBeenCalledWith('images.trash', expect.objectContaining({ images: images.map((image) => image.uuid), trashed: true }));
  expect(libraryStore.getState()).toMatchObject({ selected: [], total: 0 });
  libraryStore.setState({ collection: 'trash' }); await loadLibraryPage();
  await selectAllLibraryImages();
  expect(selectedLibraryImages().every((image) => image.trashed)).toBe(true);
  await trashLibraryPhotos(false);
  expect(images.map((image) => image.path)).toEqual(paths);
  expect(images.every((image) => !image.trashed)).toBe(true);
  expect(fake.call.mock.calls.every(([method]) => method !== 'images.remove')).toBe(true);
});
it('all means the current filter and changing the filter clears the previous selection', async () => {
  catalog(photographs(165));
  libraryStore.setState({ filter: { text: '16' } });
  await selectAllLibraryImages();
  expect(libraryStore.getState().selected).toEqual(['16', '116', '160', '161', '162', '163', '164']);
  setLibraryQuery({ filter: {} });
  expect(libraryStore.getState().selected).toEqual([]);
  expect(libraryStore.getState().selectionImages).toEqual([]);
  await vi.waitFor(() => expect(libraryStore.getState().loading).toBe(false));
});
it('a failed later page never commits a partial all-selection', async () => {
  const images = photographs(501); catalog(images);
  selectLibraryImage('0');
  fake.call.mockImplementation(async (_method: string, p: { offset: number }) => {
    if (p.offset) throw new Error('SDK read failed');
    return { images: images.slice(0, 500), total: images.length, offset: 0 };
  });
  await selectAllLibraryImages();
  expect(libraryStore.getState()).toMatchObject({ selected: ['0'], error: 'SDK read failed', busy: '' });
});
it('ignores an in-flight all-selection after switching libraries', async () => {
  catalog(photographs(80));
  let finish!: (page: unknown) => void;
  fake.call.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const selecting = selectAllLibraryImages();
  libraryStore.setState({ library: 'W2', selected: [], selectionImages: [] });
  finish({ images: photographs(80), total: 80, offset: 0 });
  await selecting;
  expect(libraryStore.getState()).toMatchObject({ library: 'W2', selected: [], selectionImages: [], error: '', busy: '' });
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

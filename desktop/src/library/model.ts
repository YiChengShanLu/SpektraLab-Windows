import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { libraryCall, recycleLibraryTrash, type LibraryInfo, type Collection, type LibraryImage, type ImagePage, type Folder, type Location, type Variant } from './client';
import { libraryBinding, type LibraryBinding } from './edits';
import { platform, joinPath } from '../platform';
import { closeLibraryEditor, flushSave, hasUnsavedEdits, openPaths, sessionStore } from '../state/session';
import { host } from '../host/client';
import { tz } from '../i18n';
import { libraryThumbs } from './thumbnails';
import { decodeSidecar, isUntouched } from '@shared/sidecar';

export interface LibraryFilter { text?: string; min_rating?: number; color_tags?: number[]; kinds?: string[]; camera_model?: string; has_edit?: boolean; captured_from?: string; captured_to?: string }
interface Recent { name: string; path: string; kind: string }
interface LibraryState {
  visible: boolean; initialized: boolean; available: boolean; sdk: string; busy: string; loading: boolean; error: string; status: string;
  library: string | null; info: LibraryInfo | null; recent: Recent[]; collections: Collection[]; folders: Folder[]; locations: Location[];
  collection: string | null; filter: LibraryFilter; sort: string; descending: boolean; offset: number; total: number; images: LibraryImage[];
  selected: string[]; variants: Record<string, string>; facets: { camera?: { value: string; count: number }[]; undescribed?: number };
  describeProgress: { done: number; total: number } | null;
  thumbnailSize: number;
}
export const libraryStore = createStore<LibraryState>()(() => ({
  visible: false, initialized: false, available: false, sdk: '', busy: '', loading: false, error: '', status: '', library: null, info: null,
  recent: [], collections: [], folders: [], locations: [], collection: null, filter: {}, sort: 'name', descending: false,
  offset: 0, total: 0, images: [], selected: [], variants: {}, facets: {}, describeProgress: null, thumbnailSize: 150,
}));
export const useLibrary = <T,>(selector: (state: LibraryState) => T) => useStore(libraryStore, selector);
const get = libraryStore.getState, set = libraryStore.setState;
export const LIBRARY_PAGE_SIZE = 80;
let queryGeneration = 0, describeCancelled = false, windows = false;
const nativePath = (path: string) => windows && /^[a-z]:\//i.test(path) ? path.replaceAll('/', '\\') : path;
const selectedImages = () => get().images.filter((image) => get().selected.includes(image.uuid));
const params = (more: Record<string, unknown> = {}) => ({ library: get().library, ...more });
async function savedEditor() {
  await flushSave();
  if (hasUnsavedEdits() || sessionStore.getState().externalEditConflict) throw new Error(tz('The current edits could not be saved. Resolve the editor error first.', '当前编辑尚未保存，请先处理编辑器中的错误。'));
}
async function work(label: string, action: () => Promise<void>): Promise<boolean> {
  if (get().busy || sessionStore.getState().batchExporting) return false;
  set({ busy: label, error: '', status: '' });
  try { await action(); return true; }
  catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return false; }
  finally { set({ busy: '' }); }
}
export async function showLibrary() {
  if (sessionStore.getState().batchExporting) return;
  sessionStore.setState({ exportOpen: false, settingsOpen: false, aboutOpen: false });
  set({ visible: true });
  await work(tz('Opening library', '正在打开图库'), async () => {
    await savedEditor();
    if (!get().initialized) {
      const [sdk, recent, paths, thumbnailSize] = await Promise.all([
        libraryCall<{ version: string; schema: number }>('sdk.version'), platform().storeRead('Library', 'recent.json'), platform().appPaths(), platform().storeRead('Library', 'thumbnail-size.json'),
      ]);
      windows = paths.os === 'windows';
      const records = Array.isArray(recent) ? recent.filter((r): r is Recent => !!r && typeof r.path === 'string' && typeof r.name === 'string').slice(0, 12) : [];
      set({ initialized: true, available: true, sdk: `${sdk.version} · schema ${sdk.schema}`, recent: records,
        thumbnailSize: typeof thumbnailSize === 'number' && Number.isFinite(thumbnailSize) ? Math.max(90, Math.min(320, thumbnailSize)) : 150 });
    }
    if (get().library) await refreshLibrary();
  });
}
export async function hideLibrary() {
  if (get().busy) return;
  describeCancelled = true; set({ visible: false });
}
export async function loadLibraryPage() {
  const state = get(); if (!state.library) return;
  const generation = ++queryGeneration;
  set({ loading: true });
  try {
    const request = { library: state.library, collection: state.collection ?? undefined, recursive: true, filter: state.filter,
      sort: state.sort, descending: state.descending, offset: state.offset, limit: LIBRARY_PAGE_SIZE, full: true, check_files: true,
      include_trashed: state.collections.find((c) => c.uuid === state.collection)?.kind === 'trash' };
    const [page, facets] = await Promise.all([
      libraryCall<ImagePage>('images.list', request), libraryCall<LibraryState['facets']>('images.facets', request),
    ]);
    if (generation !== queryGeneration) return;
    if (page.total && page.offset >= page.total) { set({ offset: 0 }); void loadLibraryPage(); return; }
    const images = page.images.map((image) => ({ ...image, path: nativePath(image.path) }));
    libraryThumbs.reset();
    set({ images, total: page.total, facets, selected: state.selected.filter((id) => images.some((image) => image.uuid === id)) });
  } catch (e) { if (generation === queryGeneration) set({ error: String(e instanceof Error ? e.message : e) }); }
  finally { if (generation === queryGeneration) set({ loading: false }); }
}
export async function refreshLibrary() {
  if (!get().library) return;
  const L = get().library;
  const [info, collections, folders, locations] = await Promise.all([
    libraryCall<LibraryInfo>('library.info', { library: L }), libraryCall<{ collections: Collection[] }>('collections.list', { library: L }),
    libraryCall<{ folders: Folder[] }>('folders.list', { library: L }), libraryCall<{ locations: Location[] }>('locations.list', { library: L }),
  ]);
  if (get().library !== L) return;
  set({ info, collections: collections.collections, folders: folders.folders, locations: locations.locations });
  await loadLibraryPage();
}
async function activate(result: { library: string; info: LibraryInfo }) {
  const recent = [{ name: result.info.name, path: result.info.path, kind: result.info.kind }, ...get().recent.filter((r) => r.path !== result.info.path)].slice(0, 12);
  queryGeneration++;
  set({ library: result.library, info: result.info, collection: null, filter: {}, offset: 0, images: [], selected: [], variants: {}, recent });
  await platform().storeWrite('Library', 'recent.json', recent);
  await refreshLibrary();
}
async function leaveCurrent() {
  await savedEditor();
  const selection = sessionStore.getState().selection;
  if (selection && libraryBinding(selection)) await closeLibraryEditor();
  if (get().library) await libraryCall('library.close', params());
}
export async function openLibrary(path: string) {
  return work(tz('Opening library', '正在打开图库'), async () => {
    await leaveCurrent(); set({ library: null, info: null });
    await activate(await libraryCall('library.open', { path }));
  });
}
export async function createLibrary(kind: 'catalog' | 'session', name: string, parent: string) {
  return work(tz('Creating library', '正在创建图库'), async () => {
    if (!name.trim() || /[<>:"/\\|?*]|[. ]$/.test(name) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) throw new Error(tz('Choose a valid library name.', '请输入有效的图库名称。'));
    await leaveCurrent(); set({ library: null, info: null });
    await activate(await libraryCall('library.create', { path: joinPath(parent, name.trim() + (kind === 'catalog' ? '.spkcatalog' : '')), kind, name: name.trim() }));
  });
}
export async function closeLibrary() {
  await work(tz('Closing library', '正在关闭图库'), async () => {
    await leaveCurrent(); queryGeneration++;
    set({ library: null, info: null, images: [], collections: [], folders: [], locations: [], total: 0, selected: [] });
  });
}
export function setLibraryQuery(change: Partial<Pick<LibraryState, 'filter' | 'collection' | 'sort' | 'descending' | 'offset'>>) {
  set({ ...change, offset: change.offset ?? 0, selected: [], error: '' }); void loadLibraryPage();
}
export function selectLibraryImage(id: string, additive = false) {
  const selected = get().selected;
  set({ selected: additive ? selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id] : [id] });
}
export function chooseVariant(image: string, variant: string) { set({ variants: { ...get().variants, [image]: variant } }); }
export function setLibraryThumbnailSize(value: number) {
  const thumbnailSize = Math.max(90, Math.min(320, value));
  if (!Number.isFinite(thumbnailSize)) return;
  set({ thumbnailSize });
  void platform().storeWrite('Library', 'thumbnail-size.json', thumbnailSize).catch((e) => set({ error: String(e) }));
}
export function activeVariant(image: LibraryImage): Variant { return image.variants.find((v) => v.uuid === get().variants[image.uuid]) ?? image.variants[0]!; }
export async function editLibraryPhotos(rows = selectedImages(), focusing?: LibraryImage) {
  await work(tz('Opening photographs', '正在打开照片'), async () => {
    await savedEditor();
    if (focusing) {
      // Like the Mac, double-click opens the entire current query into the
      // filmstrip, focused on the clicked photograph, across grid pages.
      const state = get(), context: LibraryImage[] = [], seen = new Set<string>();
      for (let offset = 0; ;) {
        const page = await libraryCall<ImagePage>('images.list', { library: state.library, collection: state.collection ?? undefined,
          filter: state.filter, sort: state.sort, descending: state.descending, recursive: true, offset, limit: 500, full: true, check_files: true,
          include_trashed: state.collections.find((c) => c.uuid === state.collection)?.kind === 'trash' });
        for (const image of page.images) {
          const path = nativePath(image.path);
          if (image.exists !== false && ['raw', 'raster', 'pair'].includes(image.kind) && !seen.has(path)) { seen.add(path); context.push({ ...image, path }); }
        }
        offset += page.images.length;
        if (!page.images.length || offset >= page.total) break;
      }
      rows = context;
      if (!rows.some((row) => row.uuid === focusing.uuid)) throw new Error(tz('The photograph is no longer available in this view.', '此照片已不在当前视图中或已离线。'));
    }
    const bindings: Record<string, LibraryBinding> = {};
    for (const image of rows) {
      if (!['raw', 'raster', 'pair'].includes(image.kind)) throw new Error(tz('This media can be organized but is not supported by the photo editor.', '此类媒体可整理，但当前照片编辑器不能打开。'));
      if (image.exists === false) throw new Error(tz('Relink the missing photograph before editing.', '照片已离线，请先重新定位。'));
      const variant = activeVariant(image);
      bindings[image.path] = { library: get().library!, image: image.uuid, variant: variant.uuid, position: variant.position };
    }
    if (!rows.length) return;
    await openPaths(rows.map((row) => row.path), bindings, focusing?.path);
    if (sessionStore.getState().lastError) throw new Error(sessionStore.getState().lastError!);
    const editor = sessionStore.getState();
    if (!editor.selection || editor.frames.length !== rows.length || !rows.some((row) => row.uuid === libraryBinding(editor.selection!)?.image))
      throw new Error(tz('The editor could not open this photograph.', '编辑器无法打开这张照片。'));
    sessionStore.setState({ picked: focusing ? [focusing.path] : editor.frames.map((row) => row.path) });
    set({ visible: false });
  });
}
export async function importLibraryPhotos(mode: 'reference' | 'copy') {
  const paths = await platform().pickFiles(tz('Import photographs', '导入照片'));
  if (!paths.length) return;
  await work(tz('Importing photographs', '正在导入照片'), async () => {
    const result = await libraryCall<{ added: number; results: { error?: { message: string } }[] }>('images.add', params({ items: paths, mode }));
    const failed = result.results.filter((r) => r.error);
    set({ status: tz(`Added ${result.added} photographs${failed.length ? `; ${failed.length} failed` : ''}.`, `已导入 ${result.added} 张${failed.length ? `，${failed.length} 张失败` : ''}。`),
      error: failed.map((r) => r.error?.message).join('\n') });
    await refreshLibrary();
  });
}
export async function watchLibraryFolder() {
  const path = await platform().pickFolder(tz('Add a folder by reference', '添加引用文件夹'));
  if (!path) return;
  await work(tz('Scanning folder', '正在扫描文件夹'), async () => {
    const result = await libraryCall<{ sync: { added: number } }>('folders.add', params({ path, recursive: true }));
    set({ status: tz(`Added ${result.sync.added} photographs.`, `已添加 ${result.sync.added} 张照片。`) });
    await refreshLibrary();
  });
}
export async function syncLibrary() {
  await work(tz('Refreshing library', '正在刷新图库'), async () => {
    await savedEditor();
    if (get().info?.origin.kind.startsWith('capture_one')) await libraryCall('library.sync', params());
    else await libraryCall('folders.sync', params());
    await refreshLibrary();
  });
}
export async function changeLibraryMetadata(patch: { rating?: number | null; color_tag?: number | null }) {
  const variants = selectedImages().map((image) => activeVariant(image).uuid);
  if (!variants.length) return;
  await work(tz('Saving labels', '正在保存标记'), async () => { await libraryCall('meta.set', params({ variants, ...patch })); await refreshLibrary(); });
}
export async function trashLibraryPhotos(trashed: boolean) {
  const images = [...get().selected]; if (!images.length) return;
  await work(tz('Updating trash', '正在更新废纸篓'), async () => { await savedEditor(); await libraryCall('images.trash', params({ images, trashed })); await refreshLibrary(); });
}
export async function cloneLibraryVariant(image: LibraryImage) {
  await work(tz('Creating variant', '正在创建变体'), async () => {
    await savedEditor(); const variant = activeVariant(image);
    if (variant.position === 1) {
      const current = await libraryCall<{ revision: number; edit: unknown }>('edit.get', params({ variant: variant.uuid }));
      if (!current.edit) {
        const legacy = await platform().sidecarLoad(image.path);
        if (legacy && typeof legacy === 'object' && !isUntouched(decodeSidecar(legacy))) { const edit = { ...legacy }; delete (edit as Record<string, unknown>)._spkRevision; await libraryCall('edit.put', params({ variant: variant.uuid, edit, base_revision: current.revision })); }
      }
    }
    const created = await libraryCall<{ variant: string }>('variant.create', params({ image: image.uuid, from_variant: variant.uuid }));
    chooseVariant(image.uuid, created.variant); await refreshLibrary();
  });
}
export async function createCollection(name: string, kind: 'album' | 'group' | 'project' | 'smart_album', criteria?: Record<string, unknown>, parent?: string) {
  return work(tz('Creating collection', '正在创建集合'), async () => {
    const created = await libraryCall<{ collection: string }>('collection.create', params({ name, kind, criteria, parent }));
    set({ collection: created.collection, offset: 0 }); await refreshLibrary();
  });
}
export async function updateCollection(collection: Collection, change: Record<string, unknown>) {
  return work(tz('Saving collection', '正在保存集合'), async () => { await libraryCall('collection.update', params({ collection: collection.uuid, ...change })); await refreshLibrary(); });
}
export async function deleteCollection(collection: Collection) {
  if (!await platform().confirm(tz('Remove collection', '移除集合'), tz('Remove this collection and its child collections? Photographs are kept.', '移除此集合及其子集合？照片会保留。'))) return;
  await work(tz('Removing collection', '正在移除集合'), async () => { await libraryCall('collection.delete', params({ collection: collection.uuid, recursive: true })); set({ collection: null, offset: 0 }); await refreshLibrary(); });
}
export async function albumMembership(collection: string, remove = false) {
  const images = [...get().selected]; if (!images.length) return;
  await work(tz('Saving album', '正在保存相册'), async () => { await libraryCall(remove ? 'collection.remove' : 'collection.add', params({ collection, images })); await refreshLibrary(); });
}
export async function removeWatchedFolder(folder: Folder) {
  await work(tz('Removing watched folder', '正在取消文件夹跟踪'), async () => { await libraryCall('folders.remove', params({ folder: folder.folder })); await refreshLibrary(); });
}
export async function forgetMissingImages() {
  const images = selectedImages().filter((image) => image.exists === false).map((image) => image.uuid);
  if (!images.length || !await platform().confirm(tz('Forget missing records', '忘记失联记录'), tz('Remove these missing-image records and their edits from this library?', '从此图库移除所选失联照片的记录和编辑？'))) return;
  await work(tz('Removing missing records', '正在移除失联记录'), async () => { await libraryCall('images.remove', params({ images })); await refreshLibrary(); });
}
export async function relinkLocation(location: Location) {
  const path = await platform().pickFolder(tz('Locate photograph folder', '重新定位照片文件夹')); if (!path) return;
  await work(tz('Relinking folder', '正在重新定位文件夹'), async () => {
    await savedEditor(); await libraryCall('location.relink', params({ location: location.uuid, path, all_matching: true }));
    if (sessionStore.getState().selection && libraryBinding(sessionStore.getState().selection!)) await closeLibraryEditor();
    await refreshLibrary();
  });
}
export async function moveSessionPhotos(to: string) {
  const images = [...get().selected]; if (!images.length) return;
  if (!await platform().confirm(tz('Move session files', '移动会话文件'), tz(`Move the selected files into the session's ${to} folder?`, `将所选文件移动到会话的 ${to} 文件夹？`))) return;
  await work(tz('Moving session files', '正在移动会话文件'), async () => {
    await savedEditor(); const report = await libraryCall<{ conflicts: unknown[] }>('session.move', params({ images, to, on_conflict: 'suffix' }));
    if (sessionStore.getState().selection && libraryBinding(sessionStore.getState().selection!)) await closeLibraryEditor();
    if (report.conflicts.length) set({ error: tz('Some files could not be moved.', '部分文件未能移动。') });
    await refreshLibrary();
  });
}
export async function restoreSessionPhotos() {
  const images = [...get().selected]; if (!images.length) return;
  if (!await platform().confirm(tz('Restore session files', '恢复会话文件'), tz('Move selected files back to their saved session folders?', '将所选文件移回之前的会话文件夹？'))) return;
  await work(tz('Restoring session files', '正在恢复会话文件'), async () => {
    await savedEditor();
    const report = await libraryCall<{ conflicts: unknown[] }>('session.restore', params({ images, on_conflict: 'suffix' }));
    if (sessionStore.getState().selection && libraryBinding(sessionStore.getState().selection!)) await closeLibraryEditor();
    if (report.conflicts.length) set({ error: tz('Some files could not be restored.', '部分文件未能恢复。') });
    await refreshLibrary();
  });
}
export async function emptySessionTrash() {
  const library = get().library;
  if (!library || get().info?.kind !== 'session' || !await platform().confirm(tz('Empty session trash', '清空会话废纸篓'),
    tz('Move files in this session’s Trash folder to the Windows Recycle Bin? Their session records and edits will be removed after each successful move.', '将此会话 Trash 文件夹中的文件送入 Windows 回收站？成功移动的文件将移除会话记录及其编辑。'))) return;
  await work(tz('Emptying session trash', '正在清空会话废纸篓'), async () => {
    await savedEditor();
    if (sessionStore.getState().selection && libraryBinding(sessionStore.getState().selection!)) await closeLibraryEditor();
    const report = await recycleLibraryTrash(library);
    set({ status: tz(`Recycled ${report.dropped} files.`, `已将 ${report.dropped} 个文件送入回收站。`), error: report.failed.map((item) => `${item.path}: ${item.message}`).concat(report.refused).join('\n') });
    await refreshLibrary();
  });
}
export async function captureOne(source: string, mode: 'link' | 'copy', destination?: string) {
  return work(tz('Reading Capture One', '正在读取 Capture One'), async () => {
    await savedEditor();
    const probe = await libraryCall<{ supported: boolean; reason: string }>('capture_one.probe', { path: source });
    if (!probe.supported) throw new Error(probe.reason);
    await leaveCurrent(); set({ library: null, info: null });
    await activate(await libraryCall(`capture_one.${mode}`, { source, ...(destination ? { path: destination } : {}) }));
  });
}
export async function updateCaptureOne() {
  await work(tz('Updating from Capture One', '正在从 Capture One 更新'), async () => {
    await savedEditor();
    const report = await libraryCall<{ conflicts_kept?: number }>('capture_one.update', params());
    set({ status: tz(`Updated; ${report.conflicts_kept ?? 0} local conflicts kept.`, `更新完成，保留 ${report.conflicts_kept ?? 0} 项本地修改冲突。`) });
    await refreshLibrary();
  });
}
export const cancelMetadataRead = () => { describeCancelled = true; };
export async function describeLibraryImages() {
  await work(tz('Reading metadata', '正在读取元数据'), async () => {
    describeCancelled = false; let done = 0, failed = 0;
    try {
      for (;;) {
        if (describeCancelled) break;
        const page = await libraryCall<ImagePage>('images.list', params({ filter: { described: false }, limit: 32, full: true }));
        if (!page.images.length) break;
        set({ describeProgress: { done, total: done + page.total } });
        const items = [];
        for (const image of page.images) {
          if (describeCancelled) break;
          let metadata: Record<string, unknown> = {};
          try {
            const info = await host().probe(nativePath(image.path)), m = info.metadata;
            metadata = { width: info.width, height: info.height, captured_local: m.datetime_original,
              camera_make: m.make, camera_model: m.model, lens: m.lens, iso: m.iso, aperture: m.aperture,
              shutter: m.shutter_s, focal_length: m.focal_mm };
          } catch { failed++; }
          items.push({ image: image.uuid, metadata }); done++;
          set({ describeProgress: { done, total: get().describeProgress!.total } });
        }
        if (items.length) await libraryCall('images.describe', params({ items }));
      }
      set({ status: tz(`Read ${done} headers${failed ? `; ${failed} unavailable` : ''}.`, `已读取 ${done} 份文件头${failed ? `，${failed} 份不可用` : ''}。`) });
      await refreshLibrary();
    } finally { set({ describeProgress: null }); }
  });
}

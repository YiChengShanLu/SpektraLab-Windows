import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { platform, joinPath } from '../platform';
import { tz } from '../i18n';
import { useSession } from '../state/session';
import { libraryThumbs } from './thumbnails';
import type { Collection, LibraryImage } from './client';
import { activeVariant, albumMembership, cancelMetadataRead, captureOne, changeLibraryMetadata, chooseVariant, cloneLibraryVariant,
  clearLibrarySelection, closeLibrary, createCollection, createLibrary, deleteCollection, describeLibraryImages, editLibraryPhotos, emptySessionTrash, forgetMissingImages,
  hideLibrary, importLibraryPhotos, libraryStore, LIBRARY_PAGE_SIZE, moveSessionPhotos, openLibrary, relinkLocation,
  removeWatchedFolder, restoreSessionPhotos, selectAllLibraryImages, selectedLibraryImages, selectLibraryImage, selectLibraryPage, setLibraryQuery, setLibraryThumbnailSize, showLibrary, syncLibrary, trashLibraryPhotos, updateCaptureOne,
  updateCollection, useLibrary, watchLibraryFolder } from './model';

const colorNames = () => [tz('None', '无'), tz('Red', '红'), tz('Orange', '橙'), tz('Yellow', '黄'), tz('Green', '绿'), tz('Blue', '蓝'), tz('Purple', '紫'), tz('Pink', '粉')];
const colorCodes = ['transparent', '#d35d56', '#db914c', '#d8bd54', '#6caa7d', '#649ac6', '#a18bc4', '#ce84ae'];
const kindName = (kind: string) => ({ root: tz('Library', '图库'), all_images: tz('All photographs', '全部照片'), recent_imports: tz('Recent imports', '最近导入'),
  trash: tz('Trash', '废纸篓'), in_library: tz('In catalog', '图库内部'), album: tz('Album', '相册'), smart_album: tz('Smart album', '智能相册'),
  group: tz('Group', '分组'), project: tz('Project', '项目'), folder: tz('Folder', '文件夹') }[kind] ?? kind);

function OriginalThumbnail({ image }: { image: LibraryImage }) {
  const ref = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(false), [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), { rootMargin: '160px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || image.exists === false || !['raw', 'raster'].includes(image.kind)) return;
    const update = () => setUrl(libraryThumbs.get(image.path));
    const off = libraryThumbs.onChange(update); update(); return () => { off(); };
  }, [image.path, image.kind, image.exists, visible]);
  return <span className="library-original" ref={ref}>{url ? <img src={url} alt="" draggable={false} /> : <span className="library-thumb-placeholder">{image.exists === false ? tz('Offline', '离线') : image.kind.toUpperCase()}</span>}</span>;
}

type Form = 'library' | 'collection' | 'rename' | 'capture' | null;
export function LibraryPage() {
  const state = useLibrary((s) => s), batch = useSession((s) => s.batchExporting);
  const [form, setForm] = useState<Form>(null), [name, setName] = useState(''), [parent, setParent] = useState('');
  const [libraryKind, setLibraryKind] = useState<'catalog' | 'session'>('catalog');
  const [collectionKind, setCollectionKind] = useState<'album' | 'group' | 'project' | 'smart_album'>('album');
  const [collectionParent, setCollectionParent] = useState(''), [source, setSource] = useState(''), [captureMode, setCaptureMode] = useState<'link' | 'copy'>('link');
  const disabled = !!state.busy || batch, current = state.collections.find((c) => c.uuid === state.collection);
  const selected = selectedLibraryImages(state), image = state.images.find((row) => state.selected.includes(row.uuid)) ?? selected[0], variant = image ? activeVariant(image) : null;
  const mirrored = !!state.info?.origin.kind.startsWith('capture_one');
  const selectedCanEdit = !!selected.length && selected.every((row) => row.exists !== false && ['raw', 'raster', 'pair'].includes(row.kind));
  useEffect(() => { if (!state.visible) libraryThumbs.reset(); }, [state.visible]);
  if (!state.visible) return null;
  const filter = (change: Partial<typeof state.filter>) => setLibraryQuery({ filter: { ...state.filter, ...change } });
  const openForm = async (next: Form) => {
    setName(next === 'rename' ? current?.title ?? '' : ''); setSource(''); setCollectionParent(next === 'rename' ? current?.parent ?? '' : '');
    if (!parent) { try { const paths = await platform().appPaths(); setParent(joinPath(paths.appData, 'Libraries')); } catch { setParent(''); } }
    setForm(next);
  };
  const submit = async () => {
    let success = false;
    if (form === 'library') success = await createLibrary(libraryKind, name, parent);
    if (form === 'collection') success = await createCollection(name, collectionKind, collectionKind === 'smart_album' ? { ...state.filter } : undefined, collectionParent || undefined);
    if (form === 'rename' && current) success = await updateCollection(current, { name, parent: collectionParent || null });
    if (form === 'capture') success = await captureOne(source, captureMode, captureMode === 'copy' ? joinPath(parent, name + '.spkcatalog') : undefined);
    if (success) setForm(null);
  };
  const depth = (collection: Collection) => { let count = 0, p = collection.parent; const seen = new Set<string>(); while (p && !seen.has(p) && count < 5) { seen.add(p); p = state.collections.find((c) => c.uuid === p)?.parent ?? null; count++; } return count; };
  const fileAction = async (row: LibraryImage, copy = false) => {
    try { if (copy) await navigator.clipboard.writeText(row.path); else await platform().reveal(row.path); }
    catch (e) { libraryStore.setState({ error: String(e) }); }
  };
  return <section className="library-page" aria-label={tz('Photo library', '照片图库')} data-testid="library-page">
    <header className="library-header">
      <div><strong>{tz('Library', '图库')}</strong><span className="caption">{state.info?.name ?? tz('Organize your photographs', '整理你的照片')}</span></div>
      <div className="library-header-actions">
        <button className="pill" onClick={() => void openForm('library')} disabled={disabled || !state.available}>{tz('New library / session', '新建图库 / 会话')}</button>
        <button className="pill" disabled={disabled || !state.available} onClick={async () => { const path = await platform().pickFolder(tz('Open library or session folder', '打开图库或会话文件夹')); if (path) void openLibrary(path); }}>{tz('Open…', '打开…')}</button>
        <button className="pill" disabled={disabled || !state.available} onClick={() => void openForm('capture')}>Capture One…</button>
        <button className="action-pill active" disabled={disabled} onClick={() => void hideLibrary()}>{tz('Editor', '返回编辑器')}</button>
      </div>
    </header>
    {(state.error || state.status || state.busy) && <div className={'library-notice' + (state.error ? ' error' : '')} role={state.error ? 'alert' : 'status'}>
      <span>{state.busy || state.error || state.status}</span>
      {state.error && <button className="pill" disabled={disabled} onClick={() => void (state.library ? syncLibrary() : showLibrary())}>{tz('Retry', '重试')}</button>}
      {state.error && <button className="icon-btn" aria-label={tz('Dismiss error', '关闭错误提示')} onClick={() => libraryStore.setState({ error: '' })}>×</button>}
    </div>}
    <div className="library-body">
      <aside className="library-rail" aria-label={tz('Libraries and collections', '图库与集合')}>
        <div className="library-section-title">{tz('Recent libraries', '最近图库')}</div>
        {state.recent.map((recent) => <button key={recent.path} className={'library-tree-row' + (state.info?.path === recent.path ? ' chosen' : '')} title={recent.path} disabled={disabled} onClick={() => void openLibrary(recent.path)}><span>{recent.name}</span><small>{recent.kind === 'session' ? tz('Session', '会话') : tz('Catalog', '目录')}</small></button>)}
        {state.info && <>
          <div className="library-section-title"><span>{tz('Collections', '集合')}</span><button className="icon-btn" title={tz('New collection', '新建集合')} disabled={disabled} onClick={() => void openForm('collection')}>＋</button></div>
          <button className={'library-tree-row' + (!state.collection ? ' chosen' : '')} disabled={disabled} onClick={() => setLibraryQuery({ collection: null })}><span>{tz('All photographs', '全部照片')}</span><small>{state.info.counts.images ?? ''}</small></button>
          {state.collections.filter((c) => c.kind !== 'root').map((collection) => <button key={collection.uuid} className={'library-tree-row' + (state.collection === collection.uuid ? ' chosen' : '')}
            style={{ paddingLeft: 12 + depth(collection) * 10 }} disabled={disabled || collection.supported === false} title={collection.supported === false ? tz('This smart album uses unsupported Capture One criteria.', '此智能相册使用尚不支持的 Capture One 条件。') : kindName(collection.kind)}
            onClick={() => setLibraryQuery({ collection: collection.uuid })}><span>{collection.title || collection.name || kindName(collection.kind)}</span><small>{collection.image_count ?? ''}</small></button>)}
          <div className="library-section-title">{tz('Watched folders', '跟踪文件夹')}</div>
          {state.folders.map((folder) => <div className="library-folder-row" key={folder.folder}><button className="library-tree-row" disabled={disabled} title={folder.path} onClick={() => setLibraryQuery({ collection: folder.collection })}><span>{folder.online ? '● ' : '○ '}{folder.path.split(/[\\/]/).pop()}</span><small>{folder.image_count}</small></button><button className="icon-btn" disabled={disabled} title={tz('Stop watching; keep photographs', '取消跟踪，保留照片')} onClick={() => void removeWatchedFolder(folder)}>×</button></div>)}
          <button className="pill library-wide" disabled={disabled || mirrored} onClick={() => void watchLibraryFolder()}>{tz('Add folder…', '添加文件夹…')}</button>
          <div className="library-rail-footer"><span className="caption">{state.info.kind === 'session' ? tz('Portable session', '可携带的会话') : tz('Photo catalog', '照片目录')}<br />{state.sdk}</span>
            <button className="pill" disabled={disabled} onClick={() => void closeLibrary()}>{tz('Close library', '关闭图库')}</button></div>
        </>}
      </aside>
      <main className="library-main">
        {!state.info ? <div className="library-empty"><h2>{tz('A home for your photographs', '给照片一个清晰的归属')}</h2><p>{tz('Create a catalog to organize existing folders, or a session with Capture, Selects and Output folders.', '新建目录来整理现有照片，或使用包含 Capture、Selects、Output 文件夹的会话。')}</p>
          <button className="action-pill active" disabled={disabled || !state.available} onClick={() => void openForm('library')}>{tz('Create library', '创建图库')}</button>
          {!state.available && <p className="caption">{tz('The native Library SDK is available in the desktop application.', '图库 SDK 需要桌面应用。若启动失败，请使用上方“重试”。')}</p>}
        </div> : <>
          <div className="library-toolbar"><strong>{current?.title || tz('All photographs', '全部照片')}</strong><span className="caption">{state.total.toLocaleString()} {tz('photographs', '张照片')}</span>
            <button className="pill" disabled={disabled} onClick={() => void importLibraryPhotos('reference')}>{tz('Import by reference', '引用导入')}</button>
            <button className="pill" disabled={disabled} onClick={() => void importLibraryPhotos('copy')}>{tz('Copy into library', '复制导入')}</button>
            <button className="pill" disabled={disabled} onClick={() => void syncLibrary()}>{tz('Refresh', '刷新')}</button>
            {state.info.copied_from && <button className="pill" disabled={disabled} onClick={() => void updateCaptureOne()}>{tz('Update from Capture One', '从 Capture One 更新')}</button>}
          </div>
          <div className="library-filters">
            <input aria-label={tz('Search filenames', '搜索文件名')} placeholder={tz('Search photographs…', '搜索照片…')} value={state.filter.text ?? ''} onChange={(e) => filter({ text: e.target.value || undefined })} disabled={disabled} />
            <select aria-label={tz('Minimum rating', '最低评级')} value={state.filter.min_rating ?? 0} onChange={(e) => filter({ min_rating: Number(e.target.value) || undefined })} disabled={disabled}>{[0, 1, 2, 3, 4, 5].map((rating) => <option value={rating} key={rating}>{rating ? `${rating} ★ +` : tz('All ratings', '全部评级')}</option>)}</select>
            <select aria-label={tz('Color label filter', '颜色标签筛选')} value={state.filter.color_tags?.[0] ?? -1} onChange={(e) => filter({ color_tags: Number(e.target.value) < 0 ? undefined : [Number(e.target.value)] })} disabled={disabled}><option value={-1}>{tz('All labels', '全部标签')}</option>{colorNames().map((label, index) => <option value={index} key={index}>{label}</option>)}</select>
            <select aria-label={tz('File type filter', '文件类型筛选')} value={state.filter.kinds?.[0] ?? ''} onChange={(e) => filter({ kinds: e.target.value ? [e.target.value] : undefined })} disabled={disabled}><option value="">{tz('All types', '全部类型')}</option>{['raw', 'raster', 'movie', 'pair'].map((kind) => <option key={kind} value={kind}>{kind.toUpperCase()}</option>)}</select>
            <select aria-label={tz('Camera filter', '相机筛选')} value={state.filter.camera_model ?? ''} onChange={(e) => filter({ camera_model: e.target.value || undefined })} disabled={disabled}><option value="">{tz('All cameras', '全部相机')}</option>{state.facets.camera?.filter((camera) => camera.value).map((camera) => <option key={camera.value} value={camera.value}>{camera.value} ({camera.count})</option>)}</select>
            <label className="library-check"><input type="checkbox" checked={!!state.filter.has_edit} onChange={(e) => filter({ has_edit: e.target.checked || undefined })} disabled={disabled} />{tz('Edited', '已编辑')}</label>
            <label>{tz('From', '拍摄自')} <input aria-label={tz('Captured from', '拍摄开始日期')} type="date" value={state.filter.captured_from ?? ''} onChange={(e) => filter({ captured_from: e.target.value || undefined })} disabled={disabled} /></label>
            <label>{tz('Before', '早于')} <input aria-label={tz('Captured before', '拍摄结束日期（不含）')} type="date" value={state.filter.captured_to ?? ''} onChange={(e) => filter({ captured_to: e.target.value || undefined })} disabled={disabled} /></label>
            <button className="pill" disabled={disabled} onClick={() => setLibraryQuery({ filter: {} })}>{tz('Clear filters', '清除筛选')}</button>
          </div>
          <div className="library-workbar">
            <button className="pill" disabled={disabled || state.loading || !state.total} onClick={() => void selectAllLibraryImages()} title={tz('Select every matching photograph across all pages (Ctrl+A)', '选择当前筛选结果的全部照片，包含其他页（Ctrl+A）')}>{tz('Select all results', '选择全部结果')}</button>
            <button className="pill" disabled={disabled || state.loading || !state.images.length} onClick={selectLibraryPage}>{tz('Select page', '选择本页')}</button>
            <button className="pill" disabled={disabled || !state.selected.length} onClick={clearLibrarySelection}>{tz('Clear selection', '取消选择')}</button>
            <span className="caption" role="status" data-testid="library-selection-count">{state.selected.length.toLocaleString()} {tz('selected · original previews', '张已选 · 原片预览')}</span>
            <label className="library-sort">{tz('Sort', '排序')} <select aria-label={tz('Sort photographs', '照片排序')} value={state.sort} onChange={(e) => setLibraryQuery({ sort: e.target.value })} disabled={disabled}>{[['name', tz('Name', '文件名')], ['captured', tz('Capture date', '拍摄时间')], ['rating', tz('Rating', '评级')], ['added', tz('Added', '添加时间')]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <button className="pill" disabled={disabled} onClick={() => setLibraryQuery({ descending: !state.descending })}>{state.descending ? '↓' : '↑'}</button>
          </div>
          {state.facets.undescribed ? <div className="library-metadata-note"><span>{state.facets.undescribed} {tz('photographs need metadata for camera/date filters.', '张照片尚需读取元数据，才能参与相机和日期筛选。')}</span><button className="pill" disabled={disabled || mirrored} onClick={() => void describeLibraryImages()}>{tz('Read metadata', '读取元数据')}</button></div> : null}
          {state.describeProgress && <div className="library-metadata-note" role="status"><progress value={state.describeProgress.done} max={state.describeProgress.total} /><span>{state.describeProgress.done} / {state.describeProgress.total}</span><button className="pill" onClick={cancelMetadataRead}>{tz('Stop after this file', '当前文件后停止')}</button></div>}
          <div className="library-grid" aria-label={tz('Photographs', '照片')} aria-busy={state.loading}
            style={{ '--library-thumbnail-size': `${state.thumbnailSize}px` } as React.CSSProperties}
            onKeyDown={(e) => {
              if (disabled || (e.target as Element).closest('input, select, textarea, [role=menu]')) return;
              if (/^[0-5]$/.test(e.key) && state.selected.length) { e.preventDefault(); void changeLibraryMetadata({ rating: Number(e.key) }); return; }
              if (e.key === 'Enter' && selectedCanEdit) { e.preventDefault(); void editLibraryPhotos(selected, selected.length === 1 ? image : undefined); return; }
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); void selectAllLibraryImages(); return; }
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
              e.preventDefault();
              const columns = getComputedStyle(e.currentTarget).gridTemplateColumns.split(' ').length;
              const at = state.images.findIndex((row) => row.uuid === state.selected.at(-1));
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? state.images.length - 1 : Math.max(0, Math.min(state.images.length - 1,
                at < 0 ? 0 : at + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -columns : columns)));
              const row = state.images[next];
              if (row) { selectLibraryImage(row.uuid, e.shiftKey); e.currentTarget.querySelectorAll<HTMLButtonElement>('.library-card-preview')[next]?.focus(); }
            }}>
            {state.loading && !state.images.length ? <p className="library-grid-message" role="status">{tz('Loading photographs…', '正在加载照片…')}</p> : !state.images.length ? <div className="library-grid-message"><p>{tz('No photographs match this view.', '当前视图没有照片。')}</p><button className="pill" disabled={disabled} onClick={() => setLibraryQuery({ filter: {}, collection: null })}>{tz('Show all photographs', '显示全部照片')}</button></div> : state.images.map((row) => <ContextMenu.Root key={row.uuid}><ContextMenu.Trigger asChild disabled={disabled}><article className={'library-card' + (state.selected.includes(row.uuid) ? ' selected' : '')}
              onContextMenu={() => { if (!state.selected.includes(row.uuid)) selectLibraryImage(row.uuid); }}>
              <button className="library-card-preview" aria-label={tz(`Select ${row.file_name}`, `选择 ${row.file_name}`)} aria-pressed={state.selected.includes(row.uuid)} disabled={disabled}
                onClick={(e) => selectLibraryImage(row.uuid, e.ctrlKey || e.metaKey || e.shiftKey)} onDoubleClick={() => void editLibraryPhotos([row], row)}>
                <OriginalThumbnail image={row} /><span className="library-card-name" title={row.file_name}>{row.file_name}</span>
              </button><div className="library-card-meta"><input type="checkbox" aria-label={tz(`Add ${row.file_name} to selection`, `将 ${row.file_name} 加入选择`)} checked={state.selected.includes(row.uuid)} disabled={disabled} onChange={() => selectLibraryImage(row.uuid, true)} />
                <span aria-label={`${activeVariant(row)?.rating ?? row.rating} stars`}>{'★'.repeat(activeVariant(row)?.rating ?? row.rating)}</span><i className="library-color" style={{ background: colorCodes[activeVariant(row)?.color_tag ?? row.color_tag] }} />
                <small>{row.variants.length > 1 ? `${row.variants.length} ${tz('variants', '个变体')}` : row.kind.toUpperCase()}</small></div>
            </article></ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="menu">
              <ContextMenu.Item className="menu-item" disabled={row.exists === false || !['raw', 'raster', 'pair'].includes(row.kind)} onSelect={() => void editLibraryPhotos([row], row)}>{tz('Edit photograph', '编辑照片')}</ContextMenu.Item>
              <ContextMenu.Item className="menu-item" onSelect={() => void cloneLibraryVariant(row)}>{tz('Duplicate variant', '复制变体')}</ContextMenu.Item>
              <ContextMenu.Item className="menu-item" onSelect={() => void fileAction(row, true)}>{tz('Copy file path', '复制文件路径')}</ContextMenu.Item>
              <ContextMenu.Item className="menu-item" disabled={row.exists === false} onSelect={() => void fileAction(row)}>{tz('Show in Explorer', '在资源管理器中显示')}</ContextMenu.Item>
            </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>)}
          </div>
          <footer className="library-pagination"><button className="pill" disabled={disabled || state.offset === 0} onClick={() => setLibraryQuery({ offset: Math.max(0, state.offset - LIBRARY_PAGE_SIZE) })}>{tz('Previous', '上一页')}</button><span>{state.total ? state.offset + 1 : 0}–{Math.min(state.offset + LIBRARY_PAGE_SIZE, state.total)} / {state.total}</span><button className="pill" disabled={disabled || state.offset + LIBRARY_PAGE_SIZE >= state.total} onClick={() => setLibraryQuery({ offset: state.offset + LIBRARY_PAGE_SIZE })}>{tz('Next', '下一页')}</button>
            <label className="library-thumbnail-size">{tz('Size', '大小')}<input type="range" min={90} max={320} step={10} value={state.thumbnailSize} aria-label={tz('Thumbnail size', '缩略图大小')} onChange={(e) => setLibraryThumbnailSize(Number(e.target.value))} /></label>
          </footer>
        </>}
      </main>
      <aside className="library-details" aria-label={tz('Selection and information', '选择与信息')}>
        {image ? <>
          <h3>{image.file_name}</h3><p className="caption library-path">{image.path}</p>
          <div className="library-form-buttons"><button className="pill" onClick={() => void fileAction(image, true)}>{tz('Copy path', '复制路径')}</button><button className="pill" disabled={image.exists === false} onClick={() => void fileAction(image)}>{tz('Show in Explorer', '在资源管理器中显示')}</button></div>
          {image.exists === false && <p className="library-offline">{tz('The source file is offline. Relink its folder below.', '原片已离线，请在下方重新定位其文件夹。')}</p>}
          <button className="action-pill active library-wide" disabled={disabled || !selectedCanEdit} onClick={() => void editLibraryPhotos()}>{tz(`Edit ${selected.length} selected`, `编辑所选 ${selected.length} 张`)}</button>
          <div className="library-section-title">{tz('Variant', '变体')}</div>
          <select aria-label={tz('Active variant', '当前变体')} value={variant?.uuid ?? ''} disabled={disabled} onChange={(e) => chooseVariant(image.uuid, e.target.value)}>{image.variants.map((v) => <option key={v.uuid} value={v.uuid}>{tz('Variant', '变体')} {v.position}{v.edit_revision ? ` · ${tz('edited', '已编辑')}` : ''}</option>)}</select>
          <button className="pill library-wide" disabled={disabled} onClick={() => void cloneLibraryVariant(image)}>{tz('Duplicate variant', '复制变体')}</button>
          <div className="library-section-title">{tz('Rating and label', '评级与标签')}</div>
          <div className="library-stars">{[0, 1, 2, 3, 4, 5].map((rating) => <button key={rating} aria-label={tz(`Rate ${rating} stars`, `评为 ${rating} 星`)} aria-pressed={variant?.rating === rating} disabled={disabled} onClick={() => void changeLibraryMetadata({ rating })}>{rating === 0 ? '×' : '★'}</button>)}</div>
          <select aria-label={tz('Set color label', '设置颜色标签')} value={variant?.color_tag ?? 0} disabled={disabled} onChange={(e) => void changeLibraryMetadata({ color_tag: Number(e.target.value) })}>{colorNames().map((label, color) => <option value={color} key={color}>{label}</option>)}</select>
          <div className="library-section-title">{tz('Album membership', '相册归属')}</div>
          <select aria-label={tz('Add selection to album', '将所选加入相册')} value="" disabled={disabled} onChange={(e) => { if (e.target.value) void albumMembership(e.target.value); }}><option value="">{tz('Add to album…', '加入相册…')}</option>{state.collections.filter((c) => c.kind === 'album' && c.editable).map((c) => <option key={c.uuid} value={c.uuid}>{c.title}</option>)}</select>
          {current?.kind === 'album' && current.editable && <button className="pill library-wide" disabled={disabled} onClick={() => void albumMembership(current.uuid, true)}>{tz('Remove from this album', '从此相册移除')}</button>}
          <div className="library-section-title">{tz('File information', '文件信息')}</div>
          <dl className="library-exif"><dt>{tz('Camera', '相机')}</dt><dd>{image.camera?.model || '—'}</dd><dt>{tz('Lens', '镜头')}</dt><dd>{image.camera?.lens || '—'}</dd><dt>ISO</dt><dd>{image.exposure?.iso ?? '—'}</dd>
            <dt>{tz('Aperture', '光圈')}</dt><dd>{image.exposure?.aperture ? `f/${Number(image.exposure.aperture.toFixed(1))}` : '—'}</dd>
            <dt>{tz('Shutter', '快门')}</dt><dd>{image.exposure?.shutter ? image.exposure.shutter < 1 ? `1/${Math.round(1 / image.exposure.shutter)} s` : `${image.exposure.shutter} s` : '—'}</dd>
            <dt>{tz('Focal length', '焦距')}</dt><dd>{image.exposure?.focal_length ? `${Number(image.exposure.focal_length.toFixed(1))} mm` : '—'}</dd>
            <dt>{tz('Dimensions', '尺寸')}</dt><dd>{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</dd>
            <dt>{tz('File size', '文件大小')}</dt><dd>{image.file_size ? `${(image.file_size / 1048576).toFixed(1)} MB` : '—'}</dd>
            <dt>{tz('Captured', '拍摄时间')}</dt><dd>{image.captured_local || '—'}</dd></dl>
          <div className="library-section-title">{tz('Organize', '整理')}</div>
          <button className="pill library-wide" disabled={disabled} onClick={() => void trashLibraryPhotos(!selected.every((row) => row.trashed))}>{selected.every((row) => row.trashed) ? tz('Restore from trash', '从废纸篓恢复') : tz('Hide in library trash', '移入图库废纸篓')}</button>
          <p className="caption">{tz('Library trash changes records and keeps source files.', '图库废纸篓保留磁盘上的原片。')}</p>
          {selected.some((row) => row.exists === false) && <button className="pill library-wide" disabled={disabled} onClick={() => void forgetMissingImages()}>{tz('Forget missing records…', '忘记失联记录…')}</button>}
          {state.info?.kind === 'session' && <select value="" aria-label={tz('Move session files', '移动会话文件')} disabled={disabled} onChange={(e) => { if (e.target.value) void moveSessionPhotos(e.target.value); }}><option value="">{tz('Move files into session…', '在会话内移动文件…')}</option>{['capture', 'selects', 'output', 'trash'].map((role) => <option key={role} value={role}>{role}</option>)}</select>}
          {state.info?.kind === 'session' && <button className="pill library-wide" disabled={disabled} onClick={() => void restoreSessionPhotos()}>{tz('Restore session files to prior folders…', '恢复会话文件至原位置…')}</button>}
        </> : <div className="library-empty-detail"><p>{tz('Select photographs to rate, label, organize or edit variants.', '选择照片后，可评级、加标签、归入相册或编辑变体。')}</p><p className="caption">{tz('Ctrl-click or use checkboxes for multiple selection.', '按住 Ctrl 点击或使用复选框可多选。')}</p></div>}
        {state.info?.kind === 'session' && <><div className="library-section-title">{tz('Session trash', '会话废纸篓')}</div><button className="pill library-wide" disabled={disabled} onClick={() => void emptySessionTrash()}>{tz('Empty into Windows Recycle Bin…', '清空至 Windows 回收站…')}</button></>}
        {current?.editable && <><div className="library-section-title">{tz('Current collection', '当前集合')}</div><button className="pill library-wide" disabled={disabled} onClick={() => void openForm('rename')}>{tz('Rename / move collection', '重命名 / 移动集合')}</button><button className="pill library-wide" disabled={disabled} onClick={() => void deleteCollection(current)}>{tz('Remove collection…', '移除集合…')}</button></>}
        {state.locations.length > 0 && <><div className="library-section-title">{tz('Locations', '文件位置')}</div>{state.locations.map((location) => <div className="library-location" key={location.uuid}><p className="caption library-path">{location.online ? '● ' : '○ '}{location.path}</p><button className="pill" disabled={disabled} onClick={() => void relinkLocation(location)}>{tz('Relink…', '重新定位…')}</button></div>)}</>}
      </aside>
    </div>
    <Dialog.Root open={form !== null} onOpenChange={(open) => { if (!open && !disabled) setForm(null); }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog library-form" aria-describedby="library-form-description">
        <Dialog.Title>{form === 'library' ? tz('New library', '新建图库') : form === 'capture' ? 'Capture One' : form === 'rename' ? tz('Rename / move collection', '重命名 / 移动集合') : tz('New collection', '新建集合')}</Dialog.Title>
        <Dialog.Description id="library-form-description" className="caption">{form === 'capture' ? tz('Read a catalog into a local mirror or independent copy. Capture One edits and previews are not converted.', '读取为本地镜像或独立副本。Capture One 的调色和预览不会转换。') : form === 'library' ? tz('A catalog organizes referenced or copied photographs. A session includes working folders.', '目录可管理引用或复制的照片；会话自带工作文件夹。') : tz('Albums contain references; removing an album keeps photographs.', '相册保存照片引用，移除相册会保留照片。')}</Dialog.Description>
        {form === 'library' && <label>{tz('Type', '类型')}<select value={libraryKind} onChange={(e) => setLibraryKind(e.target.value as 'catalog' | 'session')}><option value="catalog">{tz('Catalog', '目录')}</option><option value="session">{tz('Session', '会话')}</option></select></label>}
        {form === 'collection' && <label>{tz('Type', '类型')}<select value={collectionKind} onChange={(e) => setCollectionKind(e.target.value as typeof collectionKind)}>{['album', 'group', 'project', 'smart_album'].map((kind) => <option value={kind} key={kind}>{kindName(kind)}</option>)}</select></label>}
        {(form !== 'capture' || captureMode === 'copy') && <label>{tz('Name', '名称')}<input autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} /></label>}
        {(form === 'collection' || form === 'rename') && <label>{tz('Parent', '上级集合')}<select value={collectionParent} onChange={(e) => setCollectionParent(e.target.value)}><option value="">{tz('Top level', '顶层')}</option>{state.collections.filter((c) => c.editable && ['group', 'project'].includes(c.kind) && c.uuid !== current?.uuid).map((c) => <option value={c.uuid} key={c.uuid}>{c.title}</option>)}</select></label>}
        {form === 'collection' && collectionKind === 'smart_album' && <p className="caption">{tz('This smart album uses the current search, rating, label, type, date and camera filters.', '智能相册使用当前搜索、评级、标签、类型、日期与相机筛选条件。')}</p>}
        {form === 'capture' && <><label>{tz('Mode', '方式')}<select value={captureMode} onChange={(e) => setCaptureMode(e.target.value as 'link' | 'copy')}><option value="link">{tz('Linked mirror', '关联镜像')}</option><option value="copy">{tz('Independent editable copy', '独立可编辑副本')}</option></select></label><label>{tz('Source catalog', '源目录')}<input value={source} onChange={(e) => setSource(e.target.value)} placeholder=".cocatalogdb" /></label><div className="library-form-buttons"><button className="pill" onClick={async () => { const path = await platform().pickDocument(tz('Capture One catalog database', 'Capture One 目录数据库'), ['cocatalogdb']); if (path) setSource(path); }}>{tz('Choose database…', '选择数据库…')}</button><button className="pill" onClick={async () => { const path = await platform().pickFolder(tz('Capture One catalog package', 'Capture One 目录包')); if (path) setSource(path); }}>{tz('Choose package…', '选择目录包…')}</button></div></>}
        {(form === 'library' || form === 'capture' && captureMode === 'copy') && <label>{tz('Parent folder', '保存位置')}<div className="library-form-buttons"><input value={parent} onChange={(e) => setParent(e.target.value)} /><button className="pill" onClick={async () => { const path = await platform().pickFolder(tz('Save library in…', '图库保存位置')); if (path) setParent(path); }}>{tz('Choose…', '选择…')}</button></div></label>}
        {state.error && <p role="alert" className="library-form-error">{state.error}</p>}
        <div className="library-form-buttons end"><button className="pill" disabled={disabled} onClick={() => setForm(null)}>{tz('Cancel', '取消')}</button><button className="action-pill active" disabled={disabled || (form === 'capture' ? !source.trim() || captureMode === 'copy' && (!name.trim() || !parent.trim()) : !name.trim() || form === 'library' && !parent.trim())} onClick={() => void submit()}>{disabled ? state.busy : tz('Save', '保存')}</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}

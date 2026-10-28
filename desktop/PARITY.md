# Mac → Windows functional parity (reviewed 2026-10-27)

This replaces the obsolete initial port checklist. The Windows baseline is PR #17,
`3dba85b1dfc3326372b83da3d703ba4b9a9ac35e`, plus the local completion work.
The remote refs were refreshed for this review:

- Mac 1.x application: `origin/main`, `99c2d5c9883be485085895157279cc7c4eaa8db6`.
- Mac 2.0 Library integration: `origin/v2-ui`, `4a46ecc1b6e929c05ec8ef8202b598030b6e40e4`.
- Library SDK 0.3.1 / ABI 1 / schema 3: `afafee63ba8be068271eb18a88a020c2a41d206b`.

The Swift source was compared with the TypeScript, Rust and C++ implementations.
The read-only, hash-checked upstream snapshots and source manifests are in
`build/local/mac-full-audit/`. This is a source and Windows execution review;
there was no running Mac available for image or UI comparisons.

| Mac area | Windows implementation | Current result and limits |
|---|---|---|
| App, menus, shortcuts, typing guard | `windows/`, `platform/`, `main.tsx` | Implemented; Ctrl/F11 and Windows native menus replace macOS keys/title bar. Handled control keys no longer also move the photograph. |
| Editor window, rails, filmstrip | `windows/EditorWindow.tsx`, `PanelResize`, `Filmstrip` | Collapse, resize, double-click width reset, drag reorder, visibility and interface scale persist. |
| Theme and localization | `styles/theme.css`, `i18n/` | English/Chinese and established theme retained; Segoe/YaHei metrics differ from macOS system fonts. |
| Settings and About | `SettingsPages`, `DiagnosticSettings`, `Dialogs` | General/rendering/memory/cache/diagnostics/Agents/update check and attribution implemented. Settings/About use an in-window page/dialog. |
| Stock lists and material constraints | `StockList`, `shared/stocks.ts`, `params.ts` | Color negative/slide, monochrome film/paper, pairing and direct-scan transitions implemented using the upstream catalog. |
| Film format, grain, halation, effects | `LeftRail`, `RightRail`, engine | Feature gates, physical scale, sublayer grain, strengths, anti-halation, decoupling implemented. |
| Film edge and camera variation | `shared/filmEdge.ts`, session, native engine | Gates, strip/overscan, holes, camera/frame seeds, frame numbers, fog/leaks and held crop implemented. |
| Date backs | `LeftRail`, film-edge resolution, native engine | Faces, order, shooting data, placement/corner/size/brightness and pair text implemented. The Mac date row is EXIF-derived, not a missing free-text editor. |
| Enlarger and Solve | session, `LeftRail`, native engine | Exposure, Y/M pack, preflash, automatic solving and pair scope implemented. |
| RAW white balance and neutral picker | `shared/whiteBalance.ts`, session, native engine | As Shot, presets/custom, re-decode and picker implemented. New photographs automatically use expanded linear RGB where supported; existing Windows edits retain compatible16. Explicit policy is saved/undoable and used by pairs/exports. LibRaw replaces Apple CIRAWFilter; expanded conversion follows uint16 AHD, not float demosaic or sensor highlight recovery. |
| Lens correction | native Lensfun path | Matched profiles support distortion, camera-channel TCA and vignetting. Make disambiguates camera models, all eight RAW orientations are mapped, and gain-only correction avoids resampling. Invalid focal/aperture metadata cannot claim unsupported corrections. Apple and Lensfun profile coverage differ. |
| Latitude/Scene Placement | `shared/latitude.ts`, `RightRail`, native engine | Measured histogram, below/within/above, fixed EV axis, ISO boundaries, CIE L* separation band/full-separation range and out-of-axis indicators now present; fitted pull-back controls and refusal reasons retained. |
| Exposure/white balance post grade | `shared/adjustments.ts`, `RightRail` | Eight tone controls, WB, enable switch and reset implemented. |
| Color Balance | `ColorBalanceEditor.tsx` | Master/3-Way/shadow/midtone/highlight tabs; triangular wheels, saturation/luminance arcs, numeric controls, keyboard edits and double-click resets now implemented. |
| Curves | `CurveEditor.tsx` | Five channels, histogram, add/drag/off-plot removal, keyboard movement/deletion; right-click delete with protected endpoints and double-click channel reset now match the Mac interaction. |
| Geometry and compare | `shared/geometry.ts`, Canvas/GL renderer | Crop/aspect/straighten/rotate/flip, Ctrl-drag straighten, pan/zoom, original and split compare implemented. |
| Fresh/processed photograph workflow | `state/session.ts` | A fresh photograph now opens onto the decoded source; Solve, crop or an edit requests development. Viewing, resizing and color-space changes alone do not mark it processed. Existing edits restore their result. |
| Undo/redo and settings clipboard | session, `shared/clipboard.ts` | Grouped copy/paste/sync, per-photo save, undo/redo and pair placement implemented. Continuous slider/wheel/curve gestures remain one undo step after 500 ms. |
| Sidecar compatibility/conflicts | `shared/sidecar.ts`, `files.rs`, `agent_files.rs` | Mac schema, unknown-key preservation, moved-file identity, external edit detection and revision conflict protection implemented. |
| Import/open/drop/single instance | platform, Rust file commands | RAW/raster input, Unicode paths, recursive folder scan, individual files and launch handoff implemented. Original photo/XMP files are preserved. |
| Preview and RAW caches | displayCache, previewQueue, native decode cache | Persistent rendered/source pictures, embedded-camera prebuild, bounded work, corruption invalidation and lossless RAW cache implemented. Long filmstrips mount only nearby image consumers, retaining measured cell widths; camera thumbnail URLs use a 256-entry LRU while developed JPEGs preserve the edit on revisit. |
| Display/output color | native host, Canvas/WebGL, color-space modules | sRGB/P3 developed and original/compare views independently negotiate RGBA16; a gradient test verifies more than 256 real source levels and matching 8/16-bit color conversion. High-precision buffers and profiled exports implemented. WebView2/Vulkan/LittleCMS replace Metal/ColorSync; Mac pixel equality is unverified. |
| Export/recipes | `export/`, native `write_image` | Recipes, format/depth/space/quality/size, names/collisions, batch freezing/stop, DI/Cineon and cube export implemented. |
| Export grid/viewer and Open With | `ExportPage`, exporter, platform | Persistent grid/viewer/columns, proof, file-frame selection, export job log and recipe-selected external app implemented. |
| Memory, diagnostics and Agents | Settings, diagnostics/host, agent tools | Persisted soft memory budgets/one-operation override, cache controls, log retention/bundle, host restart and local Agent file coordination implemented. Private export/proof cleanup immediately trims unused frame buffers, including after failure/cancellation, preserving exact suspended editor results. |
| Half-frame pair | `shared/pair.ts`, session/Canvas, native engine | Native pairs, hole placement/grade/decode, film layer, swap/fill, crop and library-owned variants implemented. |
| Library catalog/session | `library/`, `library_host.rs`, original SDK | Create/open/recent, reference/copy import, watched folders, sync and locations implemented. Grid pagination bounds its display work. |
| Library organization | `library/`, SDK | Album/group/project/smart album, membership, rename/move/delete collection, ratings/colors, search/type/date/camera/has-edit filters implemented. |
| Library metadata/keyboard/file actions | LibraryPage/model | Header metadata read/cancel, offline state, shutter/aperture/focal length/dimensions/size, thumbnail-size persistence, arrows/Home/End/Enter/0-5/Ctrl+A and copy path/Explorer/context menus implemented. |
| Library → editor context | model, `openPaths(selecting)` | Double-click/Enter on one image now loads all editable photographs in the current query across SDK pages, retaining active variants and focusing the target. Explicit Edit Selected retains its batch meaning. |
| Variant editing/export | edits, session/exporter, SDK | Independent opaque settings, legacy first-variant adoption, optimistic revision and frozen batch snapshots implemented. Merely viewing an empty variant now leaves `has_edit` false. |
| Library restart recovery | `library_host.rs` | Stable frontend handles reopen their saved paths after helper restart; interrupted mutations are never replayed and stale edit revisions still fail. |
| Trash, session moves and relink | model, Rust Shell integration, SDK | Record trash/restore, session move/restore, missing-record removal, relink and session trash → Windows Recycle Bin implemented. Only successful recycled files lose SDK records; failed files remain. |
| Capture One | original SDK, library UI | Linked read-only mirror, independent copy and update supported. Capture One render settings/masks/styles/previews are not converted, as on Mac. Unsupported criteria remain explicit. Real-catalog coverage requires a supplied catalog. |
| Masks and Tone Mask | feature flags | Withdrawn/disabled by the reviewed Mac version too; not counted as a public Windows omission. |

The remaining differences are platform integrations and unperformed cross-platform
acceptance, not a claim of complete equivalence. Compare the same RAW and saved
settings on a real Mac and Windows machine before promising identical decode,
lens correction, gamut handling, GPU precision, imprints or exported pixels.

Validation commands/logs: frontend typecheck/lint/Vitest, Playwright Edge,
`spklib-tests.exe`, Rust native tests and the staged GUI. The per-run logs and
real-photo artifacts are under `build/local/mac-full-audit/` and
`build/local/mac-audit-*.log`. See `LIBRARY.md` for SDK and Capture One limits.
RAW/color follow-up checks and real-camera outputs are under `build/local/raw-color/`;
the 2026-10-28 run covers the 22 selected Sony ARW/enhanced DNG sources read-only.
Batch performance follow-up logs are under `build/local/batch-performance/`:
2844 RAW reference imports, 48 real-source edit/export stress samples, 8 full-size
staged-GUI exports, corrupt-input recovery and cancellation. Private exports read
existing RAW cache hits without populating new full-float entries.

Peak-memory follow-up logs are under `build/local/peak-memory/` (2026-10-28).
Vulkan now adopts exact-sized cached negatives instead of copying them, bounds
oversized scratch reuse, and releases dead film intermediates earlier. Export
postprocess reclaims unused float planes before allocating its CPU pixel result.
The shader calculations, float precision, RAW decode and material profiles are
unchanged. Shared-memory backends retain the file-backed negative copy path.
Matched real 33 MP Sony ARW/enhanced-DNG runs, with grain/halation/glare enabled,
reduced the native host's sampled peak private commit from 4327 to 3103 MiB in
44 view updates and six full-size ProPhoto RGB16 TIFF exports. Export time was
17.05 versus 16.92 seconds. All 44 RGBA16 payloads and TIFF sample bytes matched;
these are local workload measurements, not total GUI/VRAM limits or Mac parity.
The full 41 native tests, dedicated ownership/readback regressions, striped
pixel comparison, and idle/batch/failure/cancellation/resume checks passed.

The 2026-10-28 follow-up completed 64 full-size PNG exports in the staged GUI,
then rebuilt and repeated the same 64 after fixing thumbnail contention.
Small camera thumbnails now reuse the shared prebuilt display-cache descriptor
before requesting the render host; reads do not retain another 2048px buffer.
This keeps export-grid scrolling independent of a busy host when a preview is
already prepared, while preserving bounded JPEG retention and cache-miss fallback.
All 128 PNGs fully decoded with their ICC/dimensions verified, and the 64 RAW
sources plus copies retained their hashes. 62 repeated pixel pairs matched;
the two repeatedly developed editor frames have expected stochastic grain
differences, not claimed bit equality. The rebuilt GUI's batch process-tree
private-commit peak was 3471 MiB and settled near its pre-export 1745 MiB level;
startup/reload peaked higher (4865 MiB). These are scoped local measurements,
not physical-RAM/VRAM totals or Mac parity. Frontend checks passed 363 tests,
with one realhost unit skipped and desktop exports checked separately.
Artifacts: `build/local/peak-memory/long-gui/verification.json` and
`../Windows/长时间RAW与桌面批量验证记录.txt`.

Startup/switching follow-up (2026-10-28) reuses the live tier's exact linear
source for matching-size source previews and trims idle full-print scratch
before interactive display processing. Persistent source/negative/print
caches, stochastic film state and shader math are unchanged. File exports
retain their existing cleanup path instead of paying for a second trim.
Matched six-RAW GUI runs, including a cached revisit, reduced the sampled
process-tree private-commit maximum from 5248 to 4596 MiB (12.4%); the cached
revisit fell 19.2%, while the first startup alone fell only about 2%.
All 41 native tests passed, 30 real-source RGBA16 payloads matched byte for
byte, and two full-size RGB16 TIFF pixel streams and ICC color data matched.
These are scoped local measurements; dedicated VRAM and OS/driver variability
are not a universal memory ceiling. Evidence is under
`build/local/peak-memory/startup-*.json` and
`../Windows/启动与切图峰值优化记录.txt`.

### 2026-10-28 first-startup buffer lifetime follow-up

Stages now consume their input chains. Coupler correction releases the consumed
density plane before diffusion; completed grain affine inputs are also released
before blur. The Vulkan allocator reclaims idle, incompatible preview planes
only on large allocation misses, preserving full planes, live inputs and LUTs.
No material, shader arithmetic, RAW precision or export depth changed.

Fresh local A/B process starts used six matching owned RAW copies and a fixed
maximized window. ARW startup medians (two starts per build) were 4.21 -> 3.68
GiB total process-tree private commit (-12.69%); DNG was 3.64 -> 3.43 GiB
(-5.86%, one start per build). First-view times were effectively unchanged.
These are separate controlled measurements from the earlier 4.49 GiB record,
not an absolute ceiling or a claim of reboot-cold disk performance.

All 41 native tests passed, including new red/green memory regressions. Fifty
RGBA16 payloads across normal/striped rendering, RAW white balance and grading
were byte-identical to the preceding build. Two full-size ProPhoto RGB16 TIFF
sample streams and ICC color data matched; total export time was 5.205 -> 5.231
seconds. Six original RAWs and 42 owned copies retained their SHA-256 hashes.
Evidence: `build/local/peak-memory/cold-final-verification.json` and
`../Windows/首次启动峰值优化记录.txt`.

### 2026-10-28 daily-use stabilization

Window close now awaits sidecar persistence, keeps unsaved edits on failure,
and rejects overlapping close requests or closing during active export/library
work. Photo/folder navigation and pair transitions also preserve the current
session when saving fails. Windows menu installation preserves the restored
client size; the observed 20 px height loss on every restart is fixed.

Validation: typecheck/lint; 372 frontend tests plus the explicitly enabled
real-RAW TIFF integration test; all 47 browser workflow tests; 23 Rust tests
plus both real SDK integration tests. The remaining ignored Rust entry is a
sleeping child-process fixture used by a passing parent test. Actual desktop
restart restored the saved exposure and retained window size; six full-size
JPEGs decoded with correct orientations and Display P3 ICC profiles. Source
RAW hashes stayed unchanged. The engine binary is unchanged from the previous
41-test native gate. See `../Windows/日常使用验收记录.txt` and
`build/local/daily-*.log` for the scoped local evidence.

### 2026-10-28 clipped highlights and photo import

Expanded RAW decoding now uses LibRaw's highlight chroma blend before the
camera-to-ProPhoto transform. Saturated neutral subjects fade toward white
instead of acquiring missing-channel magenta. Float output headroom and the
compatible16 decoder are retained; lost sensor detail is not reconstructed.
An owned real Sony ARW reproduced the reported car-body highlights before the
fix and verified the decoded source, film output and full-size desktop JPEG
afterward. Two shadow regions and compatible16 source/film outputs remained
byte-identical. No source photograph changed.

The toolbar and Ctrl+O now select photographs. A labelled adjacent menu and
Ctrl+Shift+O select a folder; the empty canvas and native menu use the same
mapping. Windows folder pickers intentionally hide photo files; choosing the
folder imports its supported images recursively. Empty folders keep the
current roll and show an explanation.

Validation: 41 native tests (including a synthetic saturated-neutral Bayer
regression shown failing on the old build), 373 frontend tests, 49 browser
workflow tests, and actual Windows file/folder dialogs and 7028x4688 Display P3
JPEG export. Local private evidence is in `build/local/highlight-import/` and
is excluded from public release packages.

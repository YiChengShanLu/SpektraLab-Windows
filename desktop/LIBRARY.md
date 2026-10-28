# Windows photo library

The desktop app bundles the original MIT spklib SDK (0.3.1, ABI 1,
schema 3), sourced at the commit recorded in `library-sdk/UPSTREAM.md`.
`spklib-host.exe` runs beside `spektralab.exe`; no Python or SDK checkout is
needed on the user's machine. MSVC uses the Windows SDK's SQLite and Unicode
normalization libraries. The helper's UTF-8 manifest and preserved drive roots
are required for Chinese Windows paths.

## Use

Open **Photo library** in File or press **Ctrl+L**. Create/open a catalog
(`.spkcatalog` directory) or a session. Catalogs support referenced files,
copies into the library and recursive watched folders. Sessions additionally
provide Capture, Selects, Output and Trash working folders.

Collections include albums, groups, projects and smart albums. A smart album
captures the current filename, rating, label, file type, camera and date
filters. Selection is limited to the visible page (80 photographs); the UI
explicitly calls this “Select page”. Ctrl-click and checkboxes support batch
rating, labels, album membership and library trash. Library trash only changes
records. Session file moves require confirmation and do not overwrite files.

Metadata reading uses the existing photo host's header probe, in batches of
32. It can stop after the current file. Camera/date filtering requires metadata;
the interface reports how many records still need it. Thumbnails show camera
originals, use a separate bounded cache, and are not edited variant proofs.

Missing original folders can be relinked. Removing an album or watched folder
keeps originals. Forgetting an offline record requires confirmation; the SDK
refuses to forget records whose files still exist.

Capture One catalogs can be linked as a local mirror or copied into an
independent library, with updates from their source. The SDK reads a snapshot
and never writes into Capture One. Its supported metadata/collections are
imported; Capture One rendering adjustments, masks, styles and previews are
not converted. Unsupported smart-album conditions are shown as unavailable.

## Editor and export

Opening library photographs binds each path to its selected variant UUID.
`edit.get` / `edit.put` store the existing opaque sidecar representation,
including half-frame layouts, in the SDK database. Only an empty first variant
is initially seeded from a pre-existing folder sidecar. New variants retain
independent edits. Original RAW, XMP and shared pair recipes are not rewritten.

An optimistic revision travels with each snapshot. A changed revision stops
automatic saving and navigation, preserving the user's pending edits. Exports
freeze all selected variant settings, including frames outside the current
editor selection. Ordinary folder editing still uses its existing app-data
sidecars after leaving a library.

Merely viewing an empty variant does not create an edit record. Double-click
opens the entire filtered query in the editor across grid pages, focused on
the clicked photograph; Edit Selected explicitly opens only that batch.
Thumbnail size, keyboard navigation/rating, file context actions and detailed
EXIF readouts are available in the library grid.

Session trash can be emptied into the Windows Recycle Bin through the native
Shell `IFileOperation` with `FOFX_RECYCLEONDELETE`. Only regular files named by
the SDK session trash plan are eligible; only successful moves are committed.
Failed moves keep their records and report their individual errors.

Tauri serializes the helper's NDJSON requests, bounds replies, and kills/reaps
a stalled helper before releasing its workspace lease. A timed-out mutation
is never retried automatically. Stable editor handles reopen the saved library
path on the next request after a helper restart, retaining revision checks.
Libraries live at the chosen paths; mirrors
and recent-library records use the application data folder.

## Build and validation

Run in an x64 Visual Studio developer environment with CMake and Node:

```powershell
cd desktop
npm run build:library
npm run check
npm run test:e2e
npm run package:win
```

The packager includes the helper and SDK MIT license. The local staged build
also includes both. For native regression tests:

```powershell
../build/spklib-windows/spklib-tests.exe
$env:SPKLIB_TEST_HOST = (Resolve-Path ../build/spklib-windows/spklib-host.exe)
cd src-tauri
cargo test --release --locked -- --include-ignored
```

The real Capture One catalog census in the SDK tests is gated by
`SPKLIB_C1_CATALOG`. A passing fixture suite does not imply that a real catalog
was supplied or that every Capture One format is supported.

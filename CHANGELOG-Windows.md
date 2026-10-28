# Windows changes

## 1.3.2 Windows — 2026-10-28

Based on upstream PR #17 (`3dba85b`). These changes describe this Windows
branch, not a new upstream Mac release. Release tag: `v1.3.2-windows`.

- Added MSVC x64 builds, packaged native hosts, pinned codecs, Vulkan resources,
  the library SDK and bundled CLI/MCP runtime.
- Completed editing, half-frame pairs, film edge/date back, exposure latitude,
  curves, color balance, proofing, export recipes and photo-management workflows.
- Improved RAW headroom, lens matching, ICC-tagged export and RGBA16 preview transport.
- Reduced full-image copies and intermediate-buffer lifetimes; bounded thumbnail,
  display and RAW caches; hardened batch export and host timeouts.
- Preserve unsaved edits on failed saves; await close-time persistence and block
  closing during export/library work.
- Blend clipped RAW highlight chroma before color conversion to prevent false
  magenta on neutral highlights; retain compatible16 decoding.
- Default import opens photo files. A separate folder menu and Ctrl+Shift+O import
  folders; choosing an empty folder preserves the current roll and explains why.

Validation evidence includes real Sony ARW/DNG operations, full-size JPEG/TIFF
exports and long batch runs on an RTX 4060 Laptop GPU. The latest gates pass
41 native tests, 373 frontend tests and 49 browser workflows. This does not
establish pixel equivalence to the Mac version or universal GPU/camera support.

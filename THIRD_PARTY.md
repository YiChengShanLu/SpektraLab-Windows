# Source and license notices

SpektraLab for Windows is a derivative of [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab),
based on PR #17 (`3dba85b`). Original copyright notices and Git history are retained.
The application and engine are **GPL-3.0-or-later**; see [license/LICENSE](license/LICENSE).
Windows changes are distributed under the same license. No trademark endorsement by the upstream author is implied.

| Component | License / source |
| --- | --- |
| Original film/paper profiles and LUT data | CC BY-SA 4.0; original notices in `license/` and `modern_UI/Spektrafilm/Spektrafilm/Resources/Licenses/` |
| Product profiles and imprint font | `engine/resources_product/NOTICE.md`, `engine/resources_product/fonts/LICENSE` |
| SpektraLab_library SDK 0.3.1 | MIT, Copyright 2026 Hanze Qiu; `desktop/library-sdk/LICENSE` and `UPSTREAM.md` (exact upstream revision and port changes) |
| LibRaw 0.22.2 | LGPL-2.1 option of its dual license; original `COPYRIGHT` and `LICENSE.LGPL` included |
| Lensfun library / calibration database | LGPL-3.0-or-later / CC BY-SA 3.0; pinned commit in `engine/cmake/lens-codecs-pins.json` |
| GLib and its dependencies | LGPL-2.1-or-later and individual notices; Lensfun build copies all `LICENSES` and dependency notices |
| libheif / libde265 | LGPL; pinned archives and original license texts in the input codec build |
| OpenEXR / Imath / Little CMS / JPEG / PNG / zlib | Individual BSD, MIT and zlib-style notices in the codec builds |
| Vulkan-Headers / volk / stb | Original notices in the source tree and packaged licenses directory |
| Tauri / React / frontend and Rust dependencies | Locked versions in `desktop/package-lock.json` and `desktop/src-tauri/Cargo.lock`; generated dependency notices in `licenses/` |
| Node.js v24.19.0 (CLI/MCP runtime) | Node.js and bundled dependency licenses in `agents/NODE-LICENSE.txt`; runtime checksum in `agents/runtime.json` |
| Microsoft Visual C++ / OpenMP runtime | Microsoft redistributable components copied from Visual Studio's x64 Redist directory; see [Microsoft's redistribution documentation](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files) and applicable Visual Studio license. These DLLs are separate system runtime components. |

The release supplies complete matching application source and build scripts at its Git tag.
The accompanying dependency-source archive contains the exact native dependency sources,
including GLib subprojects, used for the build. It allows rebuilding and relinking the
GPL application with modified LGPL dependencies. Build instructions are in `docs/WINDOWS.md`;
dependency versions, URLs and SHA-256 values are in the setup scripts and pin JSON files.
Do not remove the source archives, original copyright notices, attribution or license texts
when redistributing the binaries. No personal photographs are included.

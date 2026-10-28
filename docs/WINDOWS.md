# SpektraLab for Windows

## 使用

[Windows 1.3.3 下载](https://github.com/YiChengShanLu/SpektraLab-Windows/releases/tag/v1.3.3-windows)：
选择 `-setup.exe` 安装到当前用户，或选择 `.zip` 便携版。安装版会检测并按需安装 WebView2。
当前构建未进行代码签名，Windows 可能显示未识别的发布者；发布页附有 SHA-256 和完整源码。

解压完整 Windows x64 便携包后运行 `spektralab.exe`。保留包内的
`spektralab-host.exe`、`spklib-host.exe`、`host/engine`、运行库 DLL、`agents`
和 `licenses`；只复制主程序无法正常使用。

- 工具栏导入按钮、`Ctrl+O`：选择一张或多张照片。进入文件夹后可以看到 RAW、JPEG、TIFF 等支持的文件。
- 导入按钮旁的下拉菜单、`Ctrl+Shift+O`：选择文件夹，递归导入其中支持的照片。Windows 的文件夹选择器只显示文件夹，这是系统行为；进入照片所在目录后点击“选择文件夹”。
- 新导入照片先显示解码原图。点击“配光”或调整参数后生成胶片效果。
- `Ctrl+E`：导出当前选择；导出预设分别管理格式、尺寸和色彩空间。
- `Ctrl+L`：图库。新建/打开目录或会话，管理照片、相册、评级、标签和变体。图库使用说明见源码中的 `desktop/LIBRARY.md`。

编辑与缓存保存在当前用户的 `%APPDATA%/app.spektralab.desktop/`。
照片的编辑参数通常存于其中的 `Sidecars`，不会改写 RAW 内容。
导出文件由导出预设指定，默认位于照片旁的 `SpektraLab` 子文件夹。
更换程序包会保留用户数据；重要图库与编辑记录仍应自行备份。

## 运行要求和验证范围

- Windows 10/11 x64；需要 Microsoft Edge WebView2 Runtime。没有安装时从
  [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/)安装 Evergreen Runtime。
- 支持 Vulkan compute 的显卡和厂商驱动。应用内无 CPU 渲染回退；Vulkan 开发 SDK 仅构建时使用。
- 便携包包含所需 MSVC/OpenMP 可再分发 DLL，用户无需安装 Visual Studio、Node.js 或 Python。
- 高像素 RAW 需要数 GiB 工作内存。建议 16 GiB 以上系统内存；在设置中调整内存预算和磁盘缓存。

当前实机验证为 NVIDIA RTX 4060 Laptop GPU。已有真实 Sony ARW 和增强 DNG
的导入、连续编辑、批量导出与内存测试；这不等于所有相机、AMD/Intel 显卡或干净系统均已验证。
LibRaw 不支持的压缩格式（例如 Nikon HE/HE*）会明确报错。
Windows 使用 LibRaw/Vulkan，Mac 使用 Apple RAW/Metal；尚未证明逐像素相同。
Windows 预览是 SDR sRGB / Display P3，无法声称复现 Mac 的 EDR 显示。

默认“自动 · 线性高光”保留浮点输出范围，并在解码时混合过曝区域的异常颜色，
避免中性高光发紫。已经丢失的传感器纹理无法凭此恢复。
“兼容 16 位”保留原有裁切解码方式。照片文件夹选择器隐藏照片时，应使用
“打开照片”选择单个文件，或直接确认当前文件夹。

## 从源码构建

从对应发布标签获取完整源码。Windows 编辑器在 `desktop/`（Tauri + React），
原生解码/渲染宿主在 `engine/host/`；旧 `windows_UI/` Qt 编辑器是历史实现。

安装 Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”（含 Windows SDK、
CMake 和 Ninja）、Rust MSVC 工具链、Git、Node.js **24.19.0** 和 Python **3.12+**。
在仓库根目录运行：

```powershell
python -m venv build/python
. ./build/python/Scripts/Activate.ps1
python -m pip install meson==1.9.2 ninja
./scripts/windows/build.ps1 -PrepareDependencies -Package
```

首次构建下载并校验固定版本的依赖，耗时和磁盘用量较大。以后省略
`-PrepareDependencies` 可增量构建。使用 `-DependencyDirectory D:/build-deps`
可改变依赖缓存位置；`-Python` 指定 Python，`-Jobs` 限制编译并行数。
脚本自动发现 MSVC；也可从 x64 Native Tools 命令提示符中运行 PowerShell。
不要用另一份源码或其他编译器的 CMake 缓存目录。

脚本构建 Vulkan shader、LibRaw、编解码器、镜头库、图库 SDK、前端和 GUI，
运行 CTest、前端检查和 Rust 测试，再生成 `build/release/` 下的便携 ZIP、
文件清单与 SHA-256。目录已存在时打包会拒绝覆盖，请使用新的版本/输出目录。
Node.js 运行时和许可也会一并打包。用户运行程序不需要构建环境。

原生依赖固定版本和校验值见 `engine/setup-libraw.ps1`、`engine/setup-codecs.ps1`、
`engine/cmake/input-codecs-pins.json`、`engine/cmake/lens-codecs-pins.json` 和构建脚本。
发布附带的依赖源码包可用于重建、修改和重新链接；应保留其中的许可证。

额外的浏览器工作流检查需要 Playwright Chromium：

```powershell
cd desktop
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

带真实 RAW 的可选验证：

```powershell
python engine/tests/host_source.py --host build/msvc-windows/engine/host/spektralab-host.exe --resources build/msvc-windows/engine/resources --raw D:/owned-tests/example.ARW
```

测试只使用你授权的照片副本。个人 RAW、导出结果、日志和本机路径不应随发布包上传。

## 许可证和反馈

原项目为 [JamesQiu2005/SpektraLab](https://github.com/JamesQiu2005/SpektraLab)，
Windows 分支基于 PR #17，保留原作者署名与历史。应用与引擎为 GPL-3.0-or-later；
原始配置数据为 CC BY-SA 4.0，图库 SDK 为 MIT，镜头数据库等遵循各自许可。
详见源码 `THIRD_PARTY.md` 与包内 `licenses`。

报告问题时提供 Windows 版本、显卡和驱动、相机型号、RAW 类型、操作步骤和错误文字。
日志与截图可能含个人路径、照片及位置数据，提交前请检查并移除不需要的信息。

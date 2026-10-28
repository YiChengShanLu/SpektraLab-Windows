# Windows x64 Release build. Run from PowerShell; see docs/WINDOWS.md.
[CmdletBinding()]
param(
    [string]$DependencyDirectory = (Join-Path $PSScriptRoot '../../build/deps'),
    [string]$Python = 'python',
    [int]$Jobs = 6,
    [switch]$PrepareDependencies,
    [switch]$Package
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$deps = [IO.Path]::GetFullPath($DependencyDirectory)
$build = Join-Path $repo 'build/msvc-windows'

function Run([string]$Exe, [string[]]$Arguments) {
    # PowerShell 5 treats native stderr (including normal Cargo progress) as
    # error records; the native exit status is the actual build result.
    $ErrorActionPreference = 'Continue'
    & $Exe @Arguments
    if ($LASTEXITCODE) { throw "$Exe failed ($LASTEXITCODE)" }
}

if ($env:VSCMD_ARG_TGT_ARCH -ne 'x64') {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio 2022 Build Tools: Desktop development with C++.' }
    $vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
    if (-not $vs) { throw 'MSVC x64 compiler was not found.' }
    $vcvars = Join-Path $vs 'VC/Auxiliary/Build/vcvars64.bat'
    $envLines = & $env:COMSPEC /d /s /c ('""' + $vcvars + '" >nul && set"')
    if ($LASTEXITCODE) { throw 'Cannot initialize MSVC environment.' }
    foreach ($line in $envLines) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
}
foreach ($tool in @($Python, 'cmake', 'ninja', 'node', 'npm.cmd', 'cargo', 'cl.exe', 'git')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing build tool: $tool (see docs/WINDOWS.md)." }
}
Run $Python @('-c', 'import sys; assert sys.version_info >= (3,12), "Python 3.12+ required"')

if ($PrepareDependencies) {
    Run $Python @('-c', 'import importlib.metadata as m; assert m.version("meson") == "1.9.2", "Install meson==1.9.2"')
    & "$repo/engine/setup-libraw.ps1" -DependencyDirectory $deps
    if (-not $?) { throw 'LibRaw setup failed.' }
    & "$repo/engine/setup-codecs.ps1" -DependencyDirectory "$deps/export-codecs"
    if (-not $?) { throw 'Export codec setup failed.' }
    foreach ($pin in @(
        @('Vulkan-Headers', 'b5c8f996196ba4aa6d8f97e52b5d3b6e70f7e4e2'),
        @('glslang', 'f0bd0257c308b9a26562c1a30c4748a0219cc951')
    )) {
        $dest = Join-Path $deps $pin[0]
        if (-not (Test-Path -LiteralPath "$dest/.git")) {
            Run git @('clone', '--depth', '1', '--branch', 'vulkan-sdk-1.4.341.0', "https://github.com/KhronosGroup/$($pin[0]).git", $dest)
        }
        if ((& git -C $dest rev-parse HEAD).Trim() -ne $pin[1]) { throw "Dependency revision mismatch: $dest" }
    }
    Run cmake @('-S', "$deps/glslang", '-B', "$repo/build/msvc-glslang", '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
        '-DENABLE_OPT=OFF', '-DENABLE_HLSL=OFF', '-DBUILD_TESTING=OFF', '-DENABLE_GLSLANG_BINARIES=ON')
    Run cmake @('--build', "$repo/build/msvc-glslang", '--target', 'glslang-standalone', '--parallel', "$Jobs")
    $ninja = (Get-Command ninja).Source
    foreach ($kind in @('input', 'lens')) {
        Run $Python @("$repo/engine/setup-$kind-codecs.py", '--sources', "$deps/$kind-codecs/sources", '--build', "$repo/build/msvc-$kind-codecs",
            '--install', "$deps/$kind-codecs/install-msvc", '--generator', 'Ninja', '--cc', 'cl', '--cxx', 'cl', '--make', $ninja, '--jobs', "$Jobs")
    }
}
foreach ($path in @("$deps/LibRaw-0.22.2", "$deps/Vulkan-Headers/include", "$repo/build/msvc-glslang/StandAlone/glslang.exe",
    "$deps/export-codecs/libjpeg-turbo-3.2.0", "$deps/input-codecs/install-msvc", "$deps/lens-codecs/install-msvc")) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing dependency: $path. Run with -PrepareDependencies first." }
}
Run $Python @("$PSScriptRoot/msvc-dependencies.py", $build)
$configure = @('-S', $repo, '-B', $build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
    "-DCMAKE_PROJECT_INCLUDE=$build/include-probe/msvc-dependencies.cmake", "-DSPEKTRALAB_DEPS_DIR=$deps",
    "-DSPEKTRALAB_VULKAN_HEADERS=$deps/Vulkan-Headers/include", "-DSPEKTRALAB_GLSLANG=$repo/build/msvc-glslang/StandAlone/glslang.exe",
    "-DSPEKTRALAB_LIBRAW_SOURCE=$deps/LibRaw-0.22.2", "-DSPEKTRALAB_CODECS_DIR=$deps/export-codecs",
    "-DSPEKTRALAB_INPUT_CODEC_PREFIX=$deps/input-codecs/install-msvc", "-DSPEKTRALAB_LENS_PREFIX=$deps/lens-codecs/install-msvc",
    "-DPython3_EXECUTABLE=$((Get-Command $Python).Source)", '-DSPEKTRALAB_BUILD_NATIVE_RAW=ON', '-DSPEKTRALAB_BUILD_HOST=ON',
    '-DSPEKTRALAB_BUILD_DESKTOP=OFF', '-DSPEKTRALAB_REQUIRE_VULKAN=ON', '-DSPEKTRALAB_BUILD_TEST_DLL=ON', '-DBUILD_TESTING=ON')
Run cmake $configure
Run $Python @("$PSScriptRoot/msvc-dependencies.py", $build)
Run cmake @('-S', $repo, '-B', $build)
Run cmake @('--build', $build, '--parallel', "$Jobs")
Run ctest @('--test-dir', $build, '--output-on-failure')
Push-Location "$repo/desktop"
try {
    Run npm.cmd @('ci')
    Run npm.cmd @('run', 'check')
    Run npm.cmd @('run', 'build:library')
    Run npm.cmd @('run', 'build:web')
    Push-Location 'src-tauri'
    try {
        Run cargo @('test', '--lib', '--locked', '--jobs', "$Jobs")
        $env:SPKLIB_TEST_HOST = "$repo/build/spklib-windows/spklib-host.exe"
        Run cargo @('test', '--lib', '--locked', 'library_host::tests::', '--', '--include-ignored')
        Run cargo @('build', '--release', '--locked', '--features', 'tauri/custom-protocol', '--jobs', "$Jobs")
    } finally { Pop-Location }
} finally { Pop-Location }
if ($Package) {
    Run $Python @("$PSScriptRoot/package.py", '--deps', $deps, '--redist', "$env:VCToolsRedistDir/x64")
}

"""Package the native and linked Rust/frontend dependency sources used to build."""
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--deps', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if args.output.exists():
    raise SystemExit('Refusing to overwrite dependency sources')
args.output.parent.mkdir(parents=True, exist_ok=True)
folders = ['LibRaw-0.22.2', 'Vulkan-Headers', 'glslang',
           'export-codecs/libjpeg-turbo-3.2.0', 'export-codecs/libpng-1.6.59', 'export-codecs/zlib-ng-2.3.3']
pins = json.loads((ROOT / 'engine/cmake/input-codecs-pins.json').read_text(encoding='utf-8'))
folders += ['input-codecs/sources/' + pin['name'] for pin in pins]
pins = json.loads((ROOT / 'engine/cmake/lens-codecs-pins.json').read_text(encoding='utf-8'))
folders += ['lens-codecs/sources/' + pin['name'] for pin in pins['sources']]
metadata = json.loads(subprocess.check_output(['cargo', 'metadata', '--offline', '--locked', '--filter-platform', 'x86_64-pc-windows-msvc', '--format-version', '1'],
                                             cwd=ROOT / 'desktop/src-tauri', encoding='utf-8'))
npm = 'npm.cmd' if os.name == 'nt' else 'npm'
frontend = subprocess.check_output([npm, 'ls', '--omit=dev', '--all', '--parseable'],
                                  cwd=ROOT / 'desktop', encoding='utf-8').splitlines()[1:]


def filtered(info):
    if any(part in {'.git', '__pycache__', '.DS_Store', '.wraplock'} for part in Path(info.name).parts):
        return None
    if info.issym() or info.islnk():
        return None
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    return info


with tarfile.open(args.output, 'x:xz', preset=1) as archive:
    readme = b'''Dependency sources accompanying SpektraLab Windows 1.3.2.
native/: exact native library source trees, including GLib subprojects.
rust/: linked/build dependency crate sources resolved by Cargo.lock.
frontend/: runtime frontend packages resolved by package-lock.json.
Original license files are retained. No personal photographs or build logs.

Matching application code, pins and build scripts are in the release source
archive and Git tag v1.3.2-windows. Follow docs/WINDOWS.md to build. Setup scripts
verify pristine pinned sources before building. After that setup, modifications
to LGPL libraries can be rebuilt with their CMake/Meson build directories and
the application relinked with cmake --build build/msvc-windows. Do not run the
pristine-source verification again on deliberately modified dependency trees.
Vulkan/glslang source exports omit .git; normal setup clones the pinned public
revisions to verify provenance. This archive supplies the corresponding code.
'''
    info = tarfile.TarInfo('DEPENDENCY-SOURCES.txt');info.size = len(readme);archive.addfile(info, io.BytesIO(readme))
    for folder in folders:
        source = args.deps / folder
        if not source.is_dir():
            raise FileNotFoundError(source)
        archive.add(source, arcname='native/' + folder, filter=filtered)
    for package in metadata['packages']:
        if package.get('source'):
            source = Path(package['manifest_path']).parent
            archive.add(source, arcname='rust/' + package['name'] + '-' + package['version'], filter=filtered)
    for folder in frontend:
        source = Path(folder)
        if not source.resolve().is_relative_to((ROOT / 'desktop/node_modules').resolve()):
            raise RuntimeError('Unexpected frontend dependency path')
        relative = source.relative_to(ROOT / 'desktop/node_modules').as_posix()
        archive.add(source, arcname='frontend/' + relative, filter=filtered)
print('Dependency source archive:', args.output, args.output.stat().st_size)

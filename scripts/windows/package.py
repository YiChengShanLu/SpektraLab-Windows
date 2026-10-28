"""Allowlist a portable Windows release; never package the local test folder."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deps', type=Path, required=True)
    parser.add_argument('--redist', type=Path, required=True, help='VCToolsRedistDir/x64')
    args = parser.parse_args()
    version = json.loads((ROOT / 'desktop/package.json').read_text(encoding='utf-8'))['version']
    name = f'SpektraLab-Windows-x64-{version}'
    output = ROOT / 'build/release'
    stage = output / name
    # A fresh directory makes stale files impossible and avoids recursive deletes.
    stage.mkdir(parents=True, exist_ok=False)
    native = ROOT / 'build/msvc-windows/engine'

    def copy(source, relative):
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copyfile(source, target)

    copy(ROOT / 'desktop/src-tauri/target/release/spektralab.exe', 'spektralab.exe')
    copy(native / 'host/spektralab-host.exe', 'spektralab-host.exe')
    copy(ROOT / 'build/spklib-windows/spklib-host.exe', 'spklib-host.exe')
    copy(native / 'resources', 'host/engine')
    notice_dirs = [ROOT / 'license', ROOT / 'modern_UI/Spektrafilm/Spektrafilm/Resources/Licenses',
                   native / 'third-party/LibRaw', native / 'host/third-party/codecs',
                   native / 'host/third-party/input-codecs', native / 'host/third-party/lens']
    for directory in notice_dirs:
        if not directory.is_dir():
            raise FileNotFoundError(directory)
        for file in directory.iterdir():
            if file.is_file():
                copy(file, 'licenses/' + file.name)
    for source, target in [
        ('desktop/library-sdk/LICENSE', 'spklib-LICENSE.txt'),
        ('desktop/library-sdk/UPSTREAM.md', 'spklib-UPSTREAM.md'),
        ('engine/third_party/stb/LICENSE', 'stb-LICENSE.txt'),
        ('engine/third_party/volk/LICENSE.md', 'volk-LICENSE.txt'),
        ('engine/resources_product/NOTICE.md', 'Product-profiles-NOTICE.md'),
        ('engine/resources_product/fonts/LICENSE', 'Imprint-fonts-LICENSE.txt'),
        ('THIRD_PARTY.md', 'THIRD_PARTY.md'),
    ]:
        copy(ROOT / source, 'licenses/' + target)
    copy(args.deps / 'Vulkan-Headers/LICENSE.md', 'licenses/Vulkan-Headers-LICENSE.txt')
    copy(ROOT / 'license/LICENSE', 'LICENSE.txt')
    copy(ROOT / 'docs/WINDOWS.md', 'README.md')
    copy(ROOT / 'CHANGELOG-Windows.md', 'CHANGELOG.md')
    # These are the Microsoft app-local redistributable files, never System32 copies.
    runtime_files = []
    for folder in ('Microsoft.VC143.CRT', 'Microsoft.VC143.OpenMP'):
        files = sorted((args.redist / folder).glob('*.dll'))
        if not files:
            raise FileNotFoundError(f'MSVC x64 redistributables missing: {folder}')
        for file in files:
            copy(file, file.name)
            runtime_files.append(file.name)
    required = {'msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'vcomp140.dll'}
    if not required.issubset({n.lower() for n in runtime_files}):
        raise RuntimeError('Incomplete MSVC/OpenMP runtime')
    subprocess.run(['node', 'scripts/build-agent.mjs', str(stage), '--runtime'], cwd=ROOT / 'desktop', check=True)
    subprocess.run([__import__('sys').executable, str(ROOT / 'scripts/windows/notices.py'), str(stage / 'licenses')], check=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT).strip())
    info = {'version': version, 'source_commit': commit, 'source_dirty': dirty,
            'platform': 'windows-x64', 'engine': 'MSVC Release / Vulkan', 'runtime_files': runtime_files}
    (stage / 'BUILD-INFO.json').write_text(json.dumps(info, indent=2) + '\n', encoding='utf-8')
    manifest = {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}
    (stage / 'FILE-SHA256.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    archive = output / (name + '.zip')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                bundle.write(file, name + '/' + file.relative_to(stage).as_posix())
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise RuntimeError('Release ZIP verification failed')
    (output / (archive.name + '.sha256')).write_text(digest(archive) + '  ' + archive.name + '\n', encoding='ascii')
    print(archive)


if __name__ == '__main__':
    main()

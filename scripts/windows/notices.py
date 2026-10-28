"""Collect installed dependency notices for the Windows distribution."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def collect(output):
    entries = []
    packages = []
    for manifest in (ROOT / 'desktop/node_modules').rglob('package.json'):
        # Only actual npm package roots, not embedded tests/example manifests.
        folder = manifest.parent
        if not (folder.parent.name == 'node_modules' or
                folder.parent.name.startswith('@') and folder.parent.parent.name == 'node_modules'):
            continue
        try:
            data = json.loads(manifest.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            continue
        if data.get('name') and data.get('version'):
            packages.append(('npm', data['name'], data['version'], data.get('license'), manifest.parent))
    metadata = subprocess.check_output(['cargo', 'metadata', '--offline', '--locked', '--filter-platform', 'x86_64-pc-windows-msvc', '--format-version', '1'],
                                      cwd=ROOT / 'desktop/src-tauri', encoding='utf-8')
    for data in json.loads(metadata)['packages']:
        if data.get('source'):
            packages.append(('rust', data['name'], data['version'], data.get('license'), Path(data['manifest_path']).parent))
    for ecosystem, name, version, license_name, folder in sorted(packages):
        label = re.sub(r'[^a-zA-Z0-9._-]', '_', name + '-' + version)
        dest = output / ecosystem / label
        dest.mkdir(parents=True, exist_ok=True)
        files = []
        for file in folder.iterdir():
            if file.is_file() and re.match(r'^(?:licen[cs]e|copying|copyright|notice)(?:[._-]|$)', file.name, re.I):
                shutil.copyfile(file, dest / file.name)
                files.append(file.name)
        if not files:
            # Some small packages put their entire notice in their README.
            for file in folder.glob('README*'):
                if file.is_file():
                    shutil.copyfile(file, dest / file.name)
                    files.append(file.name)
        row = {'ecosystem': ecosystem, 'name': name, 'version': version, 'license': license_name, 'notices': files}
        (dest / 'PACKAGE.json').write_text(json.dumps(row, indent=2) + '\n', encoding='utf-8')
        entries.append(row)
    (output / 'DEPENDENCIES.json').write_text(json.dumps(entries, indent=2) + '\n', encoding='utf-8')
    print('Dependency notice entries:', len(entries))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    collect(parser.parse_args().output)

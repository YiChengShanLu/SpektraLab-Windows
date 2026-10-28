// Build the vendored MIT SDK helper. Run from a Visual Studio developer
// environment on Windows; the installed Windows SDK supplies SQLite.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(desktop, '..', 'build', 'spklib-windows');
const cmake = process.env.CMAKE ?? 'cmake';
execFileSync(cmake, ['-S', resolve(desktop, 'library-sdk'), '-B', output, '-DCMAKE_BUILD_TYPE=Release'], { stdio: 'inherit', windowsHide: true });
execFileSync(cmake, ['--build', output, '--config', 'Release', '--parallel', '4'], { stdio: 'inherit', windowsHide: true });

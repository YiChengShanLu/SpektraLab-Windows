// Real SDK regression: all-page mutations operate on owned fixture records.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
const executable = process.argv[2];
if (!executable) throw new Error('Pass the path to spklib-host.exe');
const root = mkdtempSync(join(tmpdir(), 'spklib-selection-'));
const photos = join(root, 'photos'); mkdirSync(photos);
const paths = Array.from({ length: 5440 }, (_, i) => join(photos, `owned-${i}.ARW`));
for (let i = 0; i < paths.length; i++) writeFileSync(paths[i], `Owned fixture ${i}`);
const child = spawn(executable, ['--store', join(root, 'store')], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let id = 0;
async function call(method, params) {
  const request = ++id; child.stdin.write(JSON.stringify({ id: request, method, params }) + '\n');
  const { value, done } = await output.next(); assert(!done, 'SDK exited');
  const reply = JSON.parse(value); assert.equal(reply.id, request);
  assert(!reply.error, JSON.stringify(reply.error)); return reply.result;
}
try {
  assert.equal(JSON.parse((await output.next()).value).event, 'ready');
  const { library } = await call('library.create', { path: join(root, 'owned.spkcatalog'), kind: 'catalog', name: 'Owned selection fixture' });
  const added = await call('images.add', { library, mode: 'reference', items: paths });
  assert.equal(added.added, paths.length);
  const ids = [];
  for (let offset = 0; offset < paths.length; offset += 500) {
    const page = await call('images.list', { library, offset, limit: 500, full: true, check_files: false });
    assert.equal(page.total, paths.length); ids.push(...page.images.map((image) => image.uuid));
  }
  assert.equal(new Set(ids).size, paths.length);
  await call('images.trash', { library, images: ids, trashed: true });
  assert.equal((await call('images.list', { library, limit: 1 })).total, 0);
  assert.equal((await call('images.list', { library, limit: 1, include_trashed: true })).total, paths.length);
  await call('images.trash', { library, images: ids, trashed: false });
  assert.equal((await call('images.list', { library, limit: 1 })).total, paths.length);
  for (let i = 0; i < paths.length; i++) assert.equal(readFileSync(paths[i], 'utf8'), `Owned fixture ${i}`);
  await call('host.shutdown', {}); if (child.exitCode === null) await once(child, 'exit');
  console.log('Real SDK: selected, trashed and restored all 5440 records; source files unchanged.');
} finally {
  if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  const path = resolve(root);
  if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('spklib-selection-') || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe fixture cleanup target');
  rmSync(path, { recursive: true });
}

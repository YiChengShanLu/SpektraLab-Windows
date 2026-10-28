import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindLibraryEdits, loadPhotoEdits, savePhotoEdits } from './edits';
import { LibraryError } from './client';
import type * as LibraryClient from './client';
import { encodeSidecar, decodeSidecar, newSidecar } from '@shared/sidecar';
const fake = vi.hoisted(() => ({ call: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('./client', async (original) => ({ ...await original<typeof LibraryClient>(), libraryCall: fake.call }));
vi.mock('../platform', () => ({ platform: () => ({ sidecarLoad: fake.load, sidecarSave: fake.save }) }));
const path = 'K:\\新疆\\照片.ARW';
const binding = { library: 'L1', image: 'image', variant: 'first', position: 1 };
beforeEach(() => { vi.resetAllMocks(); bindLibraryEdits({ [path]: binding }); fake.load.mockResolvedValue(null); });
afterEach(() => bindLibraryEdits({}));
it('keeps an empty variant unedited while merely browsing, then saves a real adjustment', async () => {
  fake.call.mockResolvedValue({ edit: null, revision: 0 });
  const s = decodeSidecar(await loadPhotoEdits(path));
  s.decode.temperature = 5409; s.decode.tint = 16; s.params.filmEdge.seeded = true; s.params.filmEdge.frameNumber = 1;
  fake.call.mockClear();
  await savePhotoEdits(path, encodeSidecar(s));
  expect(fake.call).not.toHaveBeenCalled();
  s.adjustments = { ...s.adjustments, exposure: .5 };
  fake.call.mockResolvedValue({ revision: 1 });
  const saved = await savePhotoEdits(path, encodeSidecar(s));
  expect(fake.call).toHaveBeenCalledWith('edit.put', expect.objectContaining({ base_revision: 0 }));
  expect(saved.raw._spkLibraryRevision).toMatchObject({ revision: 1, empty: false });
});
it('seeds only the first empty variant from folder edits, without rewriting that sidecar', async () => {
  fake.call.mockResolvedValue({ edit: null, revision: 0 });
  fake.load.mockResolvedValue({ adjustments: { exposure: 1.5 }, _spkRevision: 'legacy', source: path });
  const raw = await loadPhotoEdits(path);
  const sidecar = decodeSidecar(raw);
  expect(sidecar.adjustments.exposure).toBe(1.5);
  fake.call.mockResolvedValue({ revision: 1 });
  const result = await savePhotoEdits(path, encodeSidecar(sidecar));
  expect(fake.call).toHaveBeenLastCalledWith('edit.put', expect.objectContaining({ variant: 'first', base_revision: 0,
    edit: expect.not.objectContaining({ _spkRevision: expect.anything(), _spkLibraryRevision: expect.anything(), source: expect.anything() }) }));
  expect(result.raw._spkLibraryRevision).toMatchObject({ revision: 1 });
  expect(fake.save).not.toHaveBeenCalled();
  bindLibraryEdits({ [path]: { ...binding, variant: 'second', position: 2 } }); fake.load.mockClear();
  fake.call.mockResolvedValue({ edit: null, revision: 0 });
  expect(decodeSidecar(await loadPhotoEdits(path)).adjustments.exposure).toBe(0);
  expect(fake.load).not.toHaveBeenCalled();
});
it('round trips independent variant adjustments and half-frame layouts', async () => {
  const first = encodeSidecar(newSidecar()); first._spkLibraryPair = { schemaVersion: 1, label: 'first layout' };
  first.adjustments = { ...newSidecar().adjustments, exposure: -1 };
  const second = { ...first, adjustments: { ...newSidecar().adjustments, exposure: 2 }, _spkLibraryPair: { label: 'second layout' } };
  fake.call.mockImplementation(async (method, params) => method === 'edit.get'
    ? { edit: params.variant === 'first' ? first : second, revision: 4 } : { revision: 5 });
  const raw = await loadPhotoEdits(path); expect(decodeSidecar(raw).adjustments.exposure).toBe(-1);
  const next = await savePhotoEdits(path, raw); expect(next.raw._spkLibraryPair).toEqual(first._spkLibraryPair);
  bindLibraryEdits({ [path]: { ...binding, variant: 'second', position: 2 } });
  expect(decodeSidecar(await loadPhotoEdits(path)).adjustments.exposure).toBe(2);
  await expect(savePhotoEdits(path, next.raw)).rejects.toThrow('EXTERNAL_EDIT_CONFLICT');
});
it('refuses stale revisions and preserves SDK failures instead of falling back to a sidecar', async () => {
  fake.call.mockResolvedValue({ edit: {}, revision: 2 }); const raw = await loadPhotoEdits(path);
  fake.call.mockRejectedValue(new LibraryError('conflict', 'changed'));
  await expect(savePhotoEdits(path, raw)).rejects.toThrow('EXTERNAL_EDIT_CONFLICT');
  await expect(loadPhotoEdits(path)).rejects.toThrow('changed');
  expect(fake.load).not.toHaveBeenCalled(); expect(fake.save).not.toHaveBeenCalled();
});
it('retains ordinary folder editing after leaving the library', async () => {
  bindLibraryEdits({}); const raw = encodeSidecar(newSidecar()); fake.load.mockResolvedValue(raw); fake.save.mockResolvedValue('appdata');
  expect(await loadPhotoEdits(path)).toEqual(raw);
  expect(await savePhotoEdits(path, raw)).toEqual({ location: 'appdata', raw });
  expect(fake.call).not.toHaveBeenCalled();
});

// Revisions travel with the edit snapshot, so stale library edits cannot
// overwrite another window's changes. Folder editing retains its sidecars.
import { platform } from '../platform';
import { libraryCall, LibraryError } from './client';
import { decodeSidecar, isUntouched } from '@shared/sidecar';

export interface LibraryBinding { library: string; image: string; variant: string; position: number }
type Revision = { library: string; variant: string; revision: number; empty?: boolean };
let bindings: Record<string, LibraryBinding> = {};
export const bindLibraryEdits = (next: Record<string, LibraryBinding>) => { bindings = next; };
export const libraryBinding = (path: string) => bindings[path];
export async function loadPhotoEdits(path: string): Promise<unknown | null> {
  const b = bindings[path];
  if (!b) return platform().sidecarLoad(path);
  const { edit, revision } = await libraryCall<{ edit: Record<string, unknown> | null; revision: number }>('edit.get', { library: b.library, variant: b.variant });
  const legacy = !edit && b.position === 1 ? await platform().sidecarLoad(path) : null;
  return { ...(edit ?? (legacy && typeof legacy === 'object' ? legacy : {})),
    _spkLibraryRevision: { library: b.library, variant: b.variant, revision, empty: !edit && !legacy } satisfies Revision };
}
export async function savePhotoEdits(path: string, input: unknown): Promise<{ location: string; raw: Record<string, unknown> }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid photo edit object');
  const value = input as Record<string, unknown>;
  const b = bindings[path];
  if (!b) return { location: await platform().sidecarSave(path, value), raw: value };
  const token = value._spkLibraryRevision as Revision | undefined;
  if (token?.library !== b.library || token.variant !== b.variant)
    throw new Error('EXTERNAL_EDIT_CONFLICT: Library variant changed before saving.');
  if (token.empty && token.revision === 0 && isUntouched(decodeSidecar(value)))
    return { location: `library:${b.variant}`, raw: value };
  const edit = { ...value }; delete edit._spkRevision; delete edit._spkLibraryRevision; delete edit.source;
  try {
    const saved = await libraryCall<{ revision: number }>('edit.put', { library: b.library, variant: b.variant, edit, base_revision: token.revision });
    return { location: `library:${b.variant}`, raw: { ...value, _spkLibraryRevision: { ...token, revision: saved.revision, empty: false } } };
  } catch (e) {
    if (e instanceof LibraryError && e.code === 'conflict') throw new Error('EXTERNAL_EDIT_CONFLICT: This library variant was edited by another process.');
    throw e;
  }
}

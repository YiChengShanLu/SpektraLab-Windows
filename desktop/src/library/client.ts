import { invoke } from '@tauri-apps/api/core';
import { inTauri } from '../host/transport';

export interface LibraryInfo {
  uuid: string; name: string; path: string; kind: 'catalog' | 'session';
  origin: { kind: string; path?: string; write_back?: boolean };
  copied_from?: { path: string } | null; counts: Record<string, number>;
}
export interface Collection {
  uuid: string; parent: string | null; name: string; title: string; kind: string;
  editable: boolean; image_count: number | null; supported: boolean; criteria?: Record<string, unknown>;
}
export interface Variant { uuid: string; position: number; rating: number; color_tag: number; edit_revision: number; origin: string }
export interface LibraryImage {
  uuid: string; path: string; file_name: string; kind: string; rating: number; color_tag: number;
  variants: Variant[]; exists?: boolean; trashed: boolean; described?: boolean; captured_local?: string | null;
  camera?: { make?: string; model?: string; lens?: string }; exposure?: { iso?: number; aperture?: number; shutter?: number; focal_length?: number };
  width?: number; height?: number; file_size?: number;
}
export interface Folder { folder: string; path: string; collection: string; online: boolean; image_count: number }
export interface Location { uuid: string; path: string; online: boolean; relinked?: boolean; image_count: number }
export interface ImagePage { total: number; offset: number; images: LibraryImage[] }
export class LibraryError extends Error {
  constructor(public code: string, message: string, public data?: unknown) { super(message); }
}
export async function recycleLibraryTrash(library: string) {
  return invoke<{ dropped: number; refused: string[]; failed: { path: string; message: string }[] }>('library_recycle_trash', { library });
}
export async function libraryCall<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!inTauri()) throw new LibraryError('library_unavailable', '图库需要 Windows 桌面版的原生 SDK。');
  try { return await invoke<T>('library_request', { method, params }); }
  catch (value) {
    const e = value as { code?: string; message?: string; data?: unknown };
    throw new LibraryError(e?.code ?? 'library_io', e?.message ?? String(value), e?.data);
  }
}

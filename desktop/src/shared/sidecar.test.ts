import { describe, expect, it } from 'vitest';
import { decodeSidecar, encodeSidecar, isUntouched, newSidecar } from './sidecar';

// A sidecar as the macOS app writes it (abridged, real key names).
const mac = {
  schemaVersion: 3,
  decoder: 'coreimage',
  decode: { whiteBalance: 'As Shot', temperature: 5500, tint: 0, lensCorrection: false },
  params: {
    filmStock: 'kodak_portra_160',
    printStock: 'kodak_2383',
    exposureCompensationEV: 0.6,
    autoExposureMethod: 'balanced',
    autoExposure: false,
    filmFormatMM: 36,
    filmFrame: '135',
    filmSide: 'short',
    sideLengthMM: 24,
    grainActive: true,
    halationActive: true,
    printBrightnessStops: 0,
    yFilterShift: 0,
    mFilterShift: 0,
    glareActive: true,
    scanFilm: false,
  },
  adjustments: { enabled: true, temperature: 0, tint: 0, exposure: 0.3 },
  geometry: { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, angle: -0.5, quarterTurns: 1, flipH: false, flipV: false, aspect: 'r3x2' },
  masks: [{ id: 'kept', kind: 'radial' }],
  heldCrop: { crop: { x: 0, y: 0, width: 1, height: 1 } },
  state: { processed: {} },
  source: { path: '/a/b.NEF', inode: 1, volumeID: 2, size: 3 },
};

describe('sidecar', () => {
  it('prefers expanded linear RAW for new/Mac photos and retains legacy Windows decodes', () => {
    expect(newSidecar().decode.rawMode).toBe('auto');
    expect(decodeSidecar({ decoder: 'coreimage', decode: {} }).decode.rawMode).toBe('auto');
    expect(decodeSidecar({ decoder: 'libraw', decode: {} }).decode.rawMode).toBe('compatible16');
    expect(decodeSidecar({ decoder: 'libraw', decode: { rawMode: 'headroom' } }).decode.rawMode).toBe('headroom');
    expect(decodeSidecar({ decoder: 'libraw', decode: { rawMode: 'invalid' } }).decode.rawMode).toBe('compatible16');
  });
  it('distinguishes browsing with auto-filled camera values from an actual edit', () => {
    const s = decodeSidecar(encodeSidecar(newSidecar()));
    s.decode.temperature = 5409; s.decode.tint = 16;
    s.params.filmFormatMM = 23.5;
    s.params.filmEdge = { ...s.params.filmEdge, seeded: true, cameraSeed: 123, frameSeed: 456, frameNumber: 7, edgeText: 'SONY', fNumber: 2.8 };
    s.params.dateBack = { ...s.params.dateBack, text: '2026-06-05', dataText: 'ISO 100' };
    expect(isUntouched(s)).toBe(true);
    expect(isUntouched({ ...s, state: 'processed' })).toBe(false);
    expect(isUntouched({ ...s, adjustments: { ...s.adjustments, exposure: .1 } })).toBe(false);
    expect(isUntouched({ ...s, decode: { ...s.decode, whiteBalance: 'Custom' } })).toBe(false);
    expect(isUntouched({ ...s, raw: { _spkLibraryPair: {} } })).toBe(false);
  });
  it('carries the revision of each editing snapshot independently through edits', () => {
    const oldToken = { key: 'D:/owned/a.json', base: 'a'.repeat(64) };
    const old = decodeSidecar({ ...mac, _spkRevision: oldToken });
    const fresh = decodeSidecar({ ...mac, _spkRevision: { ...oldToken, base: 'b'.repeat(64) } });
    const edited = { ...old, adjustments: { ...old.adjustments, exposure: 2 } };
    expect(encodeSidecar(edited)._spkRevision).toEqual(oldToken);
    expect(encodeSidecar(fresh)._spkRevision).not.toEqual(oldToken);
  });
  it('reads the Mac shape and keeps what it does not model', () => {
    const s = decodeSidecar(mac);
    expect(s.params.filmStock).toBe('kodak_portra_160');
    expect(s.params.autoExposure).toBe(false);
    expect(s.geometry.quarterTurns).toBe(1);
    expect(s.state).toBe('processed');
    const out = encodeSidecar(s);
    expect(out.masks).toEqual(mac.masks);
    expect(out.heldCrop).toMatchObject(mac.heldCrop);
    expect(decodeSidecar(out).heldCrop).toEqual(s.heldCrop);
    expect(out.state).toEqual({ processed: {} });
    expect((out.params as Record<string, unknown>).exposureCompensationEV).toBe(0.6);
  });

  it('a legacy `crop` becomes a geometry', () => {
    const s = decodeSidecar({ crop: { x: 0.2, y: 0, width: 0.5, height: 1 } });
    expect(s.geometry.crop.x).toBe(0.2);
    expect('crop' in encodeSidecar(s)).toBe(false);
  });

  it('a new sidecar round-trips', () => {
    const s = newSidecar();
    const back = decodeSidecar(JSON.parse(JSON.stringify(encodeSidecar(s))));
    expect(back.params).toEqual(s.params);
    expect(back.adjustments).toEqual(s.adjustments);
    expect(back.geometry).toEqual({ ...s.geometry });
  });
});

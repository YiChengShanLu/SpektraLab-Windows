import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DisplayCache from './displayCache';
const fake = vi.hoisted(() => ({ thumbnail: vi.fn(), url: vi.fn(), revoke: vi.fn(), key: vi.fn(), cached: vi.fn() }));
vi.mock('../host/client', () => ({ host: () => ({ thumbnail: fake.thumbnail }) }));
vi.mock('./frames', () => ({ rgbaToURL: fake.url }));
vi.mock('./displayCache', async (original) => ({ ...await original<typeof DisplayCache>(), displayCacheKey: fake.key, readDisplayCache: fake.cached }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); fake.key.mockResolvedValue(null); fake.cached.mockResolvedValue(null); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(fake.revoke); });
afterEach(() => vi.restoreAllMocks());
describe('thumbnail invalidation', () => {
  it('revokes an obsolete result instead of reinstalling it after an external edit', async () => {
    let finish!: (value: object) => void;
    fake.thumbnail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({});
    fake.url.mockResolvedValueOnce('blob:old').mockResolvedValueOnce('blob:new');
    const { thumbs } = await import('./thumbs');
    expect(thumbs.get('/a')).toBeNull(); thumbs.invalidate('/a'); await Promise.resolve();
    finish({}); await new Promise((r) => setTimeout(r, 0));
    expect(fake.revoke).toHaveBeenCalledWith('blob:old');
    expect(thumbs.get('/a')).toBeNull(); await new Promise((r) => setTimeout(r, 0));
    expect(thumbs.get('/a')).toBe('blob:new');
  });
  it('discards a pending old-library thumbnail after reset', async () => {
    let finish!: (value: object) => void;
    fake.thumbnail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fake.url.mockResolvedValue('blob:old-library');
    const { thumbs } = await import('./thumbs');
    thumbs.get('/a'); thumbs.reset(); await Promise.resolve(); finish({}); await new Promise((r) => setTimeout(r, 0));
    expect(fake.revoke).toHaveBeenCalledWith('blob:old-library');
  });
});

describe('thumbnail scheduling', () => {
  it('loads a prebuilt camera preview while the render host is busy, without retaining its full pixels', async () => {
    const camera = { width: 2048, height: 1365 };
    fake.key.mockResolvedValue('camera-key'); fake.cached.mockResolvedValue(camera);
    fake.thumbnail.mockImplementation(() => new Promise(() => {}));
    fake.url.mockResolvedValue('blob:cached-camera');
    const { thumbs } = await import('./thumbs');
    expect(thumbs.get('/busy.ARW')).toBeNull();
    await vi.waitFor(() => expect(thumbs.get('/busy.ARW')).toBe('blob:cached-camera'));
    expect(fake.key).toHaveBeenCalledWith({ kind: 'original', sources: ['/busy.ARW'],
      configuration: { version: 1, embeddedCameraPreview: true, longEdge: 2048, display: 'srgb', format: 'rgba8' } });
    expect(fake.cached).toHaveBeenCalledWith('camera-key', { retain: false });
    expect(fake.url).toHaveBeenCalledWith(camera);
    expect(fake.thumbnail).not.toHaveBeenCalled();
  });
  it('bounds camera URLs while retaining recent access and the developed result', async () => {
    fake.thumbnail.mockResolvedValue({});
    let serial = 0;
    fake.url.mockImplementation(async () => 'blob:camera:' + serial++);
    const { thumbs } = await import('./thumbs');
    thumbs.setPrint('/edited', 'blob:print');
    for (let i = 0; i < 256; i++) thumbs.get('/' + i);
    await vi.waitFor(() => expect(thumbs.get('/255')).toBe('blob:camera:255'));
    expect(thumbs.get('/0')).toBe('blob:camera:0');
    thumbs.get('/next');
    await vi.waitFor(() => expect(thumbs.get('/next')).toBe('blob:camera:256'));
    expect(fake.revoke).toHaveBeenCalledWith('blob:camera:1');
    expect(fake.revoke).not.toHaveBeenCalledWith('blob:camera:0');
    expect(thumbs.get('/edited')).toBe('blob:print');
    thumbs.setPrint('/edited', 'blob:replacement');
    expect(fake.revoke).toHaveBeenCalledWith('blob:print');
    thumbs.reset();
    expect(fake.revoke).toHaveBeenCalledTimes(259);
  });
  it('pauses queued work without duplicating or replacing the two active requests', async () => {
    const finishes: (() => void)[] = [];
    fake.thumbnail.mockImplementation(() => new Promise((resolve) => finishes.push(() => resolve({}))));
    fake.url.mockResolvedValue('blob:preview');
    const { thumbs } = await import('./thumbs');
    thumbs.get('/a'); thumbs.get('/b'); thumbs.get('/c');
    await Promise.resolve();
    expect(fake.thumbnail.mock.calls.map(([path]) => path)).toEqual(['/a', '/b']);
    thumbs.setPaused(true);
    finishes[0]!(); finishes[1]!();
    await new Promise((r) => setTimeout(r, 0));
    thumbs.get('/c');
    expect(fake.thumbnail).toHaveBeenCalledTimes(2);
    thumbs.setPaused(false); thumbs.setPaused(false);
    await Promise.resolve();
    expect(fake.thumbnail.mock.calls.map(([path]) => path)).toEqual(['/a', '/b', '/c']);
    finishes[2]!(); await new Promise((r) => setTimeout(r, 0));
  });

  it('only queues nearby filmstrip entries and drops unseen queued work without dropping an export request', async () => {
    fake.thumbnail.mockResolvedValue({});
    fake.url.mockResolvedValue('blob:preview');
    const { thumbs } = await import('./thumbs');
    thumbs.setPaused(true);
    thumbs.setFilmstripPaths(['/a', '/b', '/c']);
    for (const path of ['/a', '/b', '/c', '/offscreen']) thumbs.get(path, 'filmstrip');
    thumbs.get('/c'); // The export page needs this entry independently of the strip.
    thumbs.setFilmstripPaths(['/b']);
    thumbs.setPaused(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.thumbnail.mock.calls.map(([path]) => path)).toEqual(['/b', '/c']);
    thumbs.setFilmstripPaths(['/a']); thumbs.get('/a', 'filmstrip');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.thumbnail.mock.calls.map(([path]) => path)).toEqual(['/b', '/c', '/a']);
  });

  it('keeps the caller-owned pause across cache resets', async () => {
    fake.thumbnail.mockResolvedValue({}); fake.url.mockResolvedValue('blob:preview');
    const { thumbs } = await import('./thumbs');
    thumbs.setPaused(true); thumbs.get('/old'); thumbs.reset(); thumbs.get('/new');
    expect(fake.thumbnail).not.toHaveBeenCalled();
    thumbs.setPaused(false); await new Promise((r) => setTimeout(r, 0));
    expect(fake.thumbnail.mock.calls.map(([path]) => path)).toEqual(['/new']);
  });
});

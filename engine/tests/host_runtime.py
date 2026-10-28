#!/usr/bin/env python3
"""Actual-host regression for persistent RAW pixels and the soft memory budget."""
import argparse
from contextlib import contextmanager
from pathlib import Path
import tempfile

from host_smoke import Host, write_dng_without_preview, write_png
from host_proof import good
from host_source import source


@contextmanager
def running(host, resources, cache):
    h = Host([str(host), '--resources', str(resources), '--decode-cache', str(cache)])
    try:
        good(h, 'hello')
        yield h
    finally:
        if h.p.poll() is None:
            try:
                good(h, 'shutdown')
                h.p.wait(timeout=10)
            finally:
                if h.p.poll() is None:
                    h.p.kill()
                    h.p.wait(timeout=10)


def exercise(host, resources):
    with tempfile.TemporaryDirectory(prefix='spk-runtime-') as temp:
        root = Path(temp)
        cache = root / '解码缓存'
        raw = root / '原片.dng'
        write_dng_without_preview(raw)

        def opened(h, **options):
            result, _ = good(h, 'open', {'path': str(raw), **options})
            pixels = source(h, result['session'])
            good(h, 'close', {'session': result['session']})
            return result, pixels

        with running(host, resources, cache) as h:
            first, pixels = opened(h)
            assert first['timings_ms']['decode_cache_hit'] is False
            status, _ = good(h, 'memory_policy')
            assert status['decode_cache_entries'] == 1
        # This is another process: RAM or a suspended GPU session cannot satisfy it.
        with running(host, resources, cache) as h:
            second, restored = opened(h)
            assert second['timings_ms']['decode_cache_hit'] is True
            assert restored == pixels and second['metadata'] == first['metadata']
            h2, _ = h.call('open', {'path': str(raw), 'decode': {'lens_correction': True}})
            assert not h2['ok'], 'a different decode option reused an incompatible cache'
            entry = next(cache.glob('*.spkdc'))
            with entry.open('r+b') as file:
                file.seek(-1, 2)
                byte = file.read(1)
                file.seek(-1, 2)
                file.write(bytes([byte[0] ^ 1]))
            repaired, again = opened(h)
            assert repaired['timings_ms']['decode_cache_hit'] is False and again == pixels
            with raw.open('ab') as file:
                file.write(b'owned source revision')
            changed, _ = opened(h)
            assert changed['timings_ms']['decode_cache_hit'] is False

            private_raw = root / 'export-only.dng'
            write_dng_without_preview(private_raw)
            cache_before, _ = good(h, 'memory_policy')
            export_params = {'source_path': str(private_raw), 'format': 'jpeg', 'color_space': 'sRGB', 'long_edge': 96,
                             'params': {'grain_active': False, 'halation_active': False, 'glare_active': False}}
            good(h, 'export_frame', {**export_params, 'path': str(root / 'private.jpg')})
            cache_after, _ = good(h, 'memory_policy')
            assert cache_after['decode_cache_entries'] == cache_before['decode_cache_entries'], 'one-pass export polluted the RAW cache'
            # An explicit editor open still caches, and private exports still read hits.
            editor, _ = good(h, 'open', {'path': str(private_raw)})
            good(h, 'close', {'session': editor['session']})
            hits_before, _ = good(h, 'memory_policy')
            good(h, 'export_frame', {**export_params, 'path': str(root / 'cached-private.jpg')})
            hits_after, _ = good(h, 'memory_policy')
            assert hits_after['decode_cache_hits'] == hits_before['decode_cache_hits'] + 1, 'private export bypassed an existing RAW cache hit'

            png = root / '内存预算.png'
            write_png(png, 1200, 800)
            good(h, 'memory_policy', {'patch': {'reserve_mb': 0, 'working_set_mb': 64}})
            refused, _ = h.call('open', {'path': str(png)})
            assert not refused['ok'] and refused['error']['code'] == 'memory_budget'
            allowed, _ = good(h, 'open', {'path': str(png), 'memory_override': True})
            good(h, 'close', {'session': allowed['session']})
            refused, _ = h.call('open', {'path': str(png)})
            assert not refused['ok'], 'one-time override leaked into the next request'
        with running(host, resources, cache) as h:
            status, _ = good(h, 'memory_policy')
            assert status['working_set_mb'] == 64, 'memory policy did not survive restart'
            good(h, 'memory_policy', {'patch': {'unlimited': True, 'decode_cache_gib': 0}})
            status, _ = good(h, 'memory_policy', {'clear_decode_cache': True})
            assert status['decode_cache_entries'] == 0
            uncached, _ = opened(h)
            assert uncached['timings_ms']['decode_cache_hit'] is False
            assert raw.is_file() and png.is_file(), 'clearing a cache changed an original'
    print('Runtime: cross-process RAW cache, exact source preview/metadata, corruption recovery, source/options invalidation, quota, persisted memory budget and one-time override PASS')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('--resources', type=Path, required=True)
    args = parser.parse_args()
    exercise(args.host, args.resources)

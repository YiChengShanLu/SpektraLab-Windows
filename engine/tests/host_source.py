#!/usr/bin/env python3
"""Current decoded original and source-neutral wire regression; owned copies."""
import argparse
from pathlib import Path
import shutil
import struct
import tempfile

from host_smoke import Host, write_png, write_tiff16, write_dng_without_preview
from array import array
from host_proof import good


def saturated_bayer(path):
    """Neutral ramp exceeds a sensor channel's ceiling before RAW white balance."""
    w, h = 256, 96
    write_dng_without_preview(path, w, h)
    data = bytearray(path.read_bytes())
    tags = {}
    for i in range(struct.unpack_from('<H', data, 8)[0]):
        tag, kind, count, value = struct.unpack_from('<HHII', data, 10 + i * 12)
        tags[tag] = value
    # The green sensor channel saturates first; blindly preserving the other
    # channels produces a false colour on this neutral subject.
    struct.pack_into('<IIIIII', data, tags[50728], 1, 2, 1, 1, 2, 3)
    for y in range(h):
        for x in range(w):
            channel = ((0, 1), (1, 2))[y % 2][x % 2]
            neutral = (0.2 + 2.3 * x / (w - 1)) * 65535
            sample = round(min(65535, neutral / (2, 1, 1.5)[channel]))
            struct.pack_into('<H', data, tags[273] + (y * w + x) * 2, sample)
    path.write_bytes(data)


def highlight_blend(host, folder):
    raw = folder / 'saturated-neutral.dng'
    saturated_bayer(raw)
    for mode in ('auto', 'headroom'):
        opened, _ = good(host, 'open', {'path': str(raw), 'decode': {'raw_mode': mode}})
        result, data = good(host, 'render_source', {'session': opened['session'], 'long_edge': 0,
                                                   'display': 'srgb', 'format': 'rgba8'})
        w, h = result['image']['width'], result['image']['height']
        # Interior samples avoid demosaic/image borders. Fully blown neutral
        # highlights must fade to white, not expose missing-channel colour.
        for x in range(w * 3 // 4, w * 7 // 8):
            at = ((h // 2) * w + x) * 4
            rgb = data[at:at + 3]
            assert min(rgb) >= 250 and max(rgb) - min(rgb) <= 3, (mode, x, list(rgb))
        good(host, 'close', {'session': opened['session']})


def source(host, sid, display="srgb", edge=512):
    reply, pixels = good(host, "render_source", {"session": sid, "display": display,
                                               "long_edge": edge, "generation": 19})
    image = reply["image"]
    assert reply["generation"] == 19 and reply["source"] == "decoded"
    assert len(pixels) == image["width"] * image["height"] * 4
    assert max(image["width"], image["height"]) <= edge
    assert image["color_space"] == ("sRGB" if display == "srgb" else "Display P3")
    return pixels


def exercise(host, folder, raw):
    hello, _ = good(host, "hello")
    assert {"render_source", "pick_neutral"} <= set(hello["methods"])
    assert 'rgba16' in hello['source_formats']
    highlight_blend(host, folder)
    # A linear DNG must fall back automatically; explicit headroom stays strict.
    linear = folder / 'linear.dng'
    write_dng_without_preview(linear, linear=True)
    versions = []
    for mode in ('compatible16', 'auto'):
        opened, _ = good(host, 'open', {'path': str(linear), 'decode': {'raw_mode': mode}})
        assert opened['raw_decode']['requested'] == mode and opened['raw_decode']['effective'] == 'compatible16'
        versions.append(source(host, opened['session']))
        good(host, 'close', {'session': opened['session']})
    assert versions[0] == versions[1], 'automatic fallback changed compatible pixels'
    failed, data = host.call('open', {'path': str(linear), 'decode': {'raw_mode': 'headroom'}})
    assert not failed['ok'] and not data, 'explicit unsupported headroom was silently accepted'
    ramp = folder / 'linear-ramp.tiff'
    write_tiff16(ramp, 2048, 4)
    opened, _ = good(host, 'open', {'path': str(ramp)})
    for space in ('srgb', 'display-p3'):
        versions = []
        for fmt, stride in (('rgba8', 4), ('rgba16', 8)):
            result, data = good(host, 'render_source', {'session': opened['session'], 'display': space, 'long_edge': 0, 'format': fmt, 'generation': 1})
            assert result['image']['format'] == fmt and result['image']['row_bytes'] == 2048 * stride
            assert len(data) == 2048 * 4 * stride
            versions.append(data)
        wide = array('H'); wide.frombytes(versions[1])
        import sys
        if sys.byteorder != 'little': wide.byteswap()
        assert all(byte == (value * 255 + 32767) // 65535 for byte, value in zip(versions[0], wide)), 'source precision changed the colour transform'
        assert len(set(wide[0::4])) > 256, '16-bit source was expanded from 8-bit pixels'
    good(host, 'close', {'session': opened['session']})
    png = folder / "普通图像.png"
    write_png(str(png), 96, 64)
    opened, _ = good(host, "open", {"path": str(png)})
    sid = opened["session"]
    before = source(host, sid)
    assert source(host, sid, "display-p3") != before
    good(host, "set_params", {"session": sid, "delta": {"exposure_compensation_ev": 2}})
    assert source(host, sid) == before, "film edits contaminated the original"
    h, p = host.call("pick_neutral", {"session": sid, "x": .5, "y": .5})
    assert not h["ok"] and not p and h["error"]["code"] == "unsupported"
    good(host, "close", {"session": sid})
    if not raw:
        print("decoded source: PNG, display conversion and source/film isolation passed; real RAW not requested")
        return
    owned = folder / ("中性点原图" + raw.suffix)
    shutil.copyfile(raw, owned)
    for mode in ("compatible16", "headroom"):
        opened, _ = good(host, "open", {"path": str(owned), "decode": {"raw_mode": mode}})
        sid = opened["session"]
        original = source(host, sid)
        assert len(original) <= 512 * 512 * 4
        for point in ((-.1,.5), (1.1,.5), (.5,-.1), (.5,1.1)):
            h,p = host.call("pick_neutral", {"session": sid, "x": point[0], "y": point[1]})
            assert not h["ok"] and not p
        found = None
        for y in (.3,.5,.7):
            for x in (.3,.5,.7):
                h,p = host.call("pick_neutral", {"session": sid, "x": x, "y": y})
                if h["ok"]:
                    assert not p
                    found = (x,y,h["result"])
                    break
            if found:
                break
        assert found, f"{mode}: no valid calibrated patch in fixture"
        x,y,wb = found
        # The target illuminant is independent of the current decode WB.
        good(host, "redecode", {"session": sid, "decode": {"raw_mode": mode, "white_balance": {"mode": "custom", "temperature_k": 4500., "tint": 5.}}})
        changed = source(host, sid)
        assert changed != original, "decoded original did not reflect custom WB"
        picked, _ = good(host, "pick_neutral", {"session": sid, "x": x, "y": y})
        assert abs(picked["temperature_k"] - wb["temperature_k"]) / wb["temperature_k"] < .025
        assert abs(picked["tint"] - wb["tint"]) < 2
        good(host, "redecode", {"session": sid, "decode": {"raw_mode": mode}})
        assert source(host, sid) == original, "as-shot restore changed original pixels"
        good(host, "close", {"session": sid})
    print("decoded source and neutral picker: PNG, both full RAW decode modes, custom WB, calibration invariance, bounds, source isolation and exact as-shot restoration passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", required=True)
    parser.add_argument("--resources", required=True)
    parser.add_argument("--raw", type=Path)
    args = parser.parse_args()
    host = Host([args.host,"--resources",args.resources])
    try:
        with tempfile.TemporaryDirectory(prefix="spektralab-source-") as tmp:
            exercise(host,Path(tmp),args.raw)
    finally:
        if host.p.poll() is None:
            good(host,"shutdown")
            host.p.wait(timeout=20)


if __name__ == "__main__":
    main()

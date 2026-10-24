"""Colour looks for the catalog LUT packs, written from scratch for XenoCut (CC0).

Each look maps an sRGB triple (0..1) to a new one. `build.py` samples them into .cube files,
so the packs carry plain 3D LUTs that any editor (and FFmpeg's lut3d) can read.
"""
import math


def clamp(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def luma(r, g, b):
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def mix(a, b, t):
    return a + (b - a) * t


def scurve(x, k):
    """Contrast around mid-grey; k > 0 adds contrast, k < 0 flattens."""
    x = clamp(x)
    s = x * x * (3 - 2 * x)
    return clamp(mix(x, s, k)) if k >= 0 else clamp(mix(x, 0.5, -k * 0.5))


def sat(r, g, b, amount):
    y = luma(r, g, b)
    return (y + (r - y) * amount, y + (g - y) * amount, y + (b - y) * amount)


def split_tone(r, g, b, shadow, highlight, strength):
    y = clamp(luma(r, g, b))
    ws = (1 - y) ** 2 * strength
    wh = y ** 2 * strength
    return tuple(c + (s - 0.5) * ws + (h - 0.5) * wh for c, s, h in zip((r, g, b), shadow, highlight))


def lift_gain(r, g, b, lift, gain):
    return tuple(l + c * (gn - l) for c, l, gn in zip((r, g, b), lift, gain))


def teal_orange(r, g, b):
    r, g, b = split_tone(r, g, b, (0.30, 0.55, 0.62), (0.72, 0.52, 0.32), 0.55)
    r, g, b = sat(r, g, b, 1.12)
    return tuple(scurve(c, 0.35) for c in (r, g, b))


def warm_film(r, g, b):
    r, g, b = lift_gain(r, g, b, (0.05, 0.04, 0.035), (1.0, 0.96, 0.86))
    r, g, b = sat(r, g, b, 0.9)
    return tuple(scurve(c, 0.25) for c in (r, g, b))


def cool_night(r, g, b):
    r, g, b = sat(r, g, b, 0.65)
    r, g, b = lift_gain(r, g, b, (0.0, 0.02, 0.06), (0.78, 0.88, 1.0))
    return tuple(scurve(c * 0.92, 0.2) for c in (r, g, b))


def bleach_bypass(r, g, b):
    y = luma(r, g, b)
    r, g, b = (mix(c, y, 0.55) for c in (r, g, b))
    return tuple(scurve(c, 0.7) for c in (r, g, b))


def mono_silver(r, g, b):
    y = scurve(0.3 * r + 0.59 * g + 0.11 * b, 0.45)
    return (clamp(y * 0.97 + 0.01), clamp(y * 0.99 + 0.005), clamp(y * 1.02 + 0.012))


def vintage_70s(r, g, b):
    r, g, b = split_tone(r, g, b, (0.58, 0.42, 0.55), (0.62, 0.58, 0.36), 0.5)
    r, g, b = lift_gain(r, g, b, (0.08, 0.06, 0.07), (0.98, 0.95, 0.80))
    return sat(r, g, b, 0.8)


def matte_fade(r, g, b):
    r, g, b = lift_gain(r, g, b, (0.11, 0.11, 0.12), (0.93, 0.93, 0.92))
    r, g, b = sat(r, g, b, 0.78)
    return tuple(scurve(c, -0.15) for c in (r, g, b))


def cross_process(r, g, b):
    r = scurve(r, 0.6)
    g = scurve(g * 1.04, 0.3)
    b = clamp(0.18 + b * 0.62)
    return sat(r, g, b, 1.1)


def golden_hour(r, g, b):
    r, g, b = lift_gain(r, g, b, (0.03, 0.015, 0.0), (1.0, 0.9, 0.7))
    r, g, b = sat(r, g, b, 1.18)
    return tuple(scurve(c, 0.15) for c in (r, g, b))


def neon_night(r, g, b):
    # Night-club split: magenta shadows, cyan highlights, a touch darker and more saturated.
    r, g, b = sat(r, g, b, 1.15)
    r, g, b = split_tone(r, g, b, (0.68, 0.32, 0.72), (0.36, 0.62, 0.68), 0.7)
    return tuple(scurve(c * 0.95, 0.3) for c in (r, g, b))


def forest_green(r, g, b):
    r, g, b = split_tone(r, g, b, (0.42, 0.55, 0.45), (0.58, 0.56, 0.42), 0.45)
    r, g, b = sat(r, g, b, 0.92)
    return tuple(scurve(c, 0.25) for c in (r, g, b))


def desert_dust(r, g, b):
    r, g, b = sat(r, g, b, 0.7)
    r, g, b = lift_gain(r, g, b, (0.06, 0.045, 0.03), (1.0, 0.92, 0.78))
    return tuple(scurve(c, 0.2) for c in (r, g, b))


LOOKS = {
    "teal_orange": teal_orange,
    "warm_film": warm_film,
    "cool_night": cool_night,
    "bleach_bypass": bleach_bypass,
    "mono_silver": mono_silver,
    "vintage_70s": vintage_70s,
    "matte_fade": matte_fade,
    "cross_process": cross_process,
    "golden_hour": golden_hour,
    "neon_night": neon_night,
    "forest_green": forest_green,
    "desert_dust": desert_dust,
}


def cube_text(name, fn, size=25):
    out = [f'TITLE "{name}"', "# XenoCut catalog look, CC0 1.0 (public domain)", f"LUT_3D_SIZE {size}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    n = size - 1
    for bi in range(size):
        for gi in range(size):
            for ri in range(size):
                r, g, b = fn(ri / n, gi / n, bi / n)
                out.append(f"{clamp(r):.5f} {clamp(g):.5f} {clamp(b):.5f}")
    return "\n".join(out) + "\n"

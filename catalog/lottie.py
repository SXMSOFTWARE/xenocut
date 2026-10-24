#!/usr/bin/env python3
"""Generates the CC0 Lottie packs (catalog/src/lottie-stickers, catalog/src/lottie-titles):
original Bodymovin JSON animations drawn from code, so every shape here is ours to license.
Run it before build.py. Python 3 standard library only; output is deterministic.
"""
import json
import math
import pathlib
import random

ROOT = pathlib.Path(__file__).resolve().parent
FR = 30
EASE_OUT = {"o": {"x": [0.2], "y": [0.8]}, "i": {"x": [0.3], "y": [1]}}
EASE_IO = {"o": {"x": [0.6], "y": [0]}, "i": {"x": [0.4], "y": [1]}}
LINEAR = {"o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}}
BACK = {"o": {"x": [0.3], "y": [0]}, "i": {"x": [0.3], "y": [1.6]}}


def hexrgb(h, a=1.0):
    h = h.lstrip("#")
    return [round(int(h[i : i + 2], 16) / 255, 4) for i in (0, 2, 4)] + [a]


def st(v):
    return {"a": 0, "k": v}


def anim(keys, ease=EASE_OUT):
    """keys: [(frame, value)], value number or list. Holds after the last key."""
    out = []
    for i, (t, v) in enumerate(keys):
        k = {"t": t, "s": v if isinstance(v, list) else [v]}
        if i < len(keys) - 1:
            e = ease[i] if isinstance(ease, list) else ease
            n = len(k["s"])
            k["o"] = {"x": e["o"]["x"] * n, "y": e["o"]["y"] * n}
            k["i"] = {"x": e["i"]["x"] * n, "y": e["i"]["y"] * n}
        out.append(k)
    return {"a": 1, "k": out}


def ks(p=(0, 0), a=(0, 0), s=100, r=0, o=100):
    def prop(v, dims):
        if isinstance(v, dict):
            return v
        if dims == 1:
            return st(v)
        if isinstance(v, (int, float)):
            return st([v, v, 100])
        return st(list(v) + ([0] if len(v) == 2 and dims == 3 else []))

    return {"o": prop(o, 1), "r": prop(r, 1), "p": prop(p, 3), "a": prop(a, 3), "s": prop(s, 3)}


def tr(p=(0, 0), s=100, r=0, o=100):
    t = {"ty": "tr", "a": st([0, 0])}
    t["p"] = p if isinstance(p, dict) else st(list(p))
    t["s"] = s if isinstance(s, dict) else st([s, s])
    t["r"] = r if isinstance(r, dict) else st(r)
    t["o"] = o if isinstance(o, dict) else st(o)
    return t


def group(items, nm="g", **t):
    return {"ty": "gr", "nm": nm, "it": items + [tr(**t)]}


def ellipse(w, h=None, p=(0, 0)):
    return {"ty": "el", "d": 1, "p": st(list(p)), "s": w if isinstance(w, dict) else st([w, h if h is not None else w])}


def rect(w, h, r=0, p=(0, 0)):
    return {"ty": "rc", "d": 1, "p": st(list(p)), "s": w if isinstance(w, dict) else st([w, h]), "r": st(r)}


def star(outer, inner, points=5, rot=0):
    return {"ty": "sr", "sy": 1, "d": 1, "pt": st(points), "p": st([0, 0]), "r": st(rot), "ir": st(inner), "is": st(0), "or": st(outer), "os": st(0)}


def path(points, closed=False, tangents=None):
    n = len(points)
    zero = [[0, 0]] * n
    i, o = (tangents if tangents else (zero, zero))
    return {"ty": "sh", "ks": st({"i": i, "o": o, "v": [list(p) for p in points], "c": closed})}


def smooth(points, closed=False, k=0.35):
    """Catmull-Rom-ish tangents for a smooth path through the points."""
    n = len(points)
    ins, outs = [], []
    for j in range(n):
        a = points[(j - 1) % n] if (closed or j > 0) else points[j]
        b = points[(j + 1) % n] if (closed or j < n - 1) else points[j]
        d = [(b[0] - a[0]) * k / 2, (b[1] - a[1]) * k / 2]
        ins.append([-d[0], -d[1]])
        outs.append(d)
    return path(points, closed, (ins, outs))


def fill(c, o=100):
    return {"ty": "fl", "c": st(hexrgb(c)), "o": o if isinstance(o, dict) else st(o), "r": 1}


def stroke(c, w, o=100):
    return {"ty": "st", "c": st(hexrgb(c)), "o": o if isinstance(o, dict) else st(o), "w": w if isinstance(w, dict) else st(w), "lc": 2, "lj": 2}


def trim(s=None, e=None, o=0):
    return {"ty": "tm", "s": s if s is not None else st(0), "e": e if e is not None else st(100), "o": st(o), "m": 1}


def layer(ind, nm, shapes, op, transform=None, ip=0):
    return {"ddd": 0, "ind": ind, "ty": 4, "nm": nm, "sr": 1, "ks": transform or ks(), "ao": 0, "shapes": shapes, "ip": ip, "op": op, "st": 0, "bm": 0}


def text_layer(ind, nm, text, size, font, color, op, transform, justify=2, tracking=0):
    return {
        "ddd": 0, "ind": ind, "ty": 5, "nm": nm, "sr": 1, "ks": transform, "ao": 0, "ip": 0, "op": op, "st": 0, "bm": 0,
        "t": {
            "d": {"k": [{"s": {"s": size, "f": font, "t": text, "j": justify, "tr": tracking, "lh": size * 1.2, "ls": 0, "fc": hexrgb(color)[:3]}, "t": 0}]},
            "p": {}, "m": {"g": 1, "a": st([0, 0])}, "a": [],
        },
    }


FONTS = {
    "Inter-ExtraBold": {"fName": "Inter-ExtraBold", "fFamily": "Inter", "fStyle": "ExtraBold", "fWeight": "800", "ascent": 72.7, "fOrigin": "n"},
    "Anton-Regular": {"fName": "Anton-Regular", "fFamily": "Anton", "fStyle": "Regular", "fWeight": "400", "ascent": 80, "fOrigin": "n"},
    "BebasNeue-Regular": {"fName": "BebasNeue-Regular", "fFamily": "Bebas Neue", "fStyle": "Regular", "fWeight": "400", "ascent": 70, "fOrigin": "n"},
}


def comp(nm, w, h, op, layers):
    used = sorted({l["t"]["d"]["k"][0]["s"]["f"] for l in layers if l["ty"] == 5})
    for i, l in enumerate(layers):
        l["ind"] = i + 1
    out = {"v": "5.7.4", "fr": FR, "ip": 0, "op": op, "w": w, "h": h, "nm": nm, "ddd": 0, "assets": [], "layers": layers}
    if used:
        out["fonts"] = {"list": [FONTS[f] for f in used]}
    return out


# ---------------------------------------------------------------------------- stickers (512)

S = 512
C = (S / 2, S / 2)


def sparkle_burst():
    op = 60
    rnd = random.Random(7)
    layers = []
    for i in range(8):
        ang = i * math.pi / 4 + 0.2
        dist = 150 + rnd.random() * 60
        start = i * 3
        col = ["#ffd65c", "#ffffff", "#7ee8fa", "#ff8ad8"][i % 4]
        size = 34 + rnd.random() * 26
        p = anim([(start, list(C)), (start + 22, [C[0] + math.cos(ang) * dist, C[1] + math.sin(ang) * dist])])
        sc = anim([(start, [0, 0, 100]), (start + 12, [120, 120, 100]), (start + 30, [60, 60, 100]), (start + 40, [0, 0, 100])], [BACK, EASE_IO, EASE_IO])
        layers.append(layer(0, f"spark{i}", [group([star(size, size * 0.38, 4), fill(col)])], op, ks(p=p, s=sc, r=anim([(start, 0), (start + 40, 90)], LINEAR))))
    core = ks(p=list(C), s=anim([(0, [0, 0, 100]), (8, [130, 130, 100]), (16, [100, 100, 100]), (40, [100, 100, 100]), (52, [0, 0, 100])], [BACK, EASE_IO, LINEAR, EASE_IO]), r=anim([(0, -30), (52, 60)], LINEAR))
    layers.append(layer(0, "core", [group([star(90, 26, 4), fill("#fff3c4")])], op, core))
    return comp("Sparkle Burst", S, S, op, layers)


HEART = [(0, 70), (-110, -20), (-60, -95), (0, -50), (60, -95), (110, -20)]


def heart_shape(scale=1.0):
    v = [[x * scale, y * scale] for x, y in [(0, 90), (-120, -10), (-62, -100), (0, -55), (62, -100), (120, -10)]]
    i = [[0, 0], [0, 50], [-35, 0], [0, -30], [-30, 0], [0, -45]]
    o = [[0, 0], [0, -45], [30, 0], [0, -30], [35, 0], [0, 50]]
    i = [[a * scale, b * scale] for a, b in i]
    o = [[a * scale, b * scale] for a, b in o]
    # point 0 (bottom tip) is a corner; the lobes are smooth.
    return path(v, True, (i, o))


def heart_pop():
    op = 50
    layers = []
    for i in range(10):
        ang = i * math.pi * 2 / 10
        start = 6
        p = anim([(start, list(C)), (start + 20, [C[0] + math.cos(ang) * 190, C[1] + math.sin(ang) * 190])])
        o = anim([(start, 100), (start + 24, 0)], LINEAR)
        layers.append(layer(0, f"dot{i}", [group([ellipse(22), fill("#ff5c8a" if i % 2 else "#ffd1dc")])], op, ks(p=p, o=o)))
    sc = anim([(0, [0, 0, 100]), (10, [125, 125, 100]), (18, [92, 92, 100]), (26, [105, 105, 100]), (32, [100, 100, 100])], [BACK, EASE_IO, EASE_IO, EASE_IO])
    layers.append(layer(0, "heart", [group([heart_shape(1.0), fill("#ff3d6e")]), group([ellipse(36, 24, (-60, -55)), fill("#ffffff", 45)], r=-30)], op, ks(p=[C[0], C[1] + 10], s=sc)))
    return comp("Heart Pop", S, S, op, layers)


def check_done():
    op = 60
    ring = group([ellipse(300), stroke("#3ddc84", 28), trim(e=anim([(0, 0), (18, 100)], EASE_IO))], r=-90)
    tick = group([path([(-70, 5), (-20, 55), (80, -55)]), stroke("#ffffff", 30), trim(e=anim([(16, 0), (30, 100)], EASE_OUT))])
    disc = group([ellipse(anim([(14, [0, 0]), (26, [272, 272])], BACK)), fill("#3ddc84")])
    sc = anim([(26, [100, 100, 100]), (32, [110, 110, 100]), (40, [100, 100, 100])], EASE_IO)
    return comp("Done Check", S, S, op, [layer(0, "tick", [tick], op, ks(p=list(C), s=sc)), layer(0, "disc", [disc], op, ks(p=list(C), s=sc)), layer(0, "ring", [ring], op, ks(p=list(C)))])


def swipe_up():
    op = 45
    chevron = lambda y, o: group([path([(-70, 35), (0, -35), (70, 35)]), stroke("#ffffff", 26, o)], p=(0, y))
    layers = []
    for i in range(3):
        o = anim([(i * 5, 0), (i * 5 + 10, 100), (i * 5 + 25, 0)], LINEAR)
        layers.append(layer(0, f"chev{i}", [chevron(60 - i * 70, o)], op, ks(p=list(C))))
    bounce = anim([(0, [C[0], C[1] + 20]), (22, [C[0], C[1] - 20]), (44, [C[0], C[1] + 20])], EASE_IO)
    for l in layers:
        l["ks"]["p"] = bounce
    return comp("Swipe Up", S, S, op, layers)


def loading_ring():
    op = 48
    arc = group([ellipse(260), stroke("#ffffff", 26), trim(s=anim([(8, 0), (40, 100)], EASE_IO), e=anim([(0, 0), (32, 100)], EASE_IO))])
    track = group([ellipse(260), stroke("#ffffff", 26, 18)])
    return comp("Loading", S, S, op, [layer(0, "arc", [arc], op, ks(p=list(C), r=anim([(0, 0), (48, 360)], LINEAR))), layer(0, "track", [track], op, ks(p=list(C)))])


def radar_pulse():
    op = 60
    layers = []
    for i in range(3):
        s0 = i * 20
        sc = anim([(s0, [10, 10, 100]), (s0 + 40, [100, 100, 100])], EASE_OUT)
        o = anim([(s0, 100), (s0 + 40, 0)], LINEAR)
        layers.append(layer(0, f"ring{i}", [group([ellipse(440), stroke("#5cc8ff", 14)])], op, ks(p=list(C), s=sc, o=o)))
    layers.append(layer(0, "dot", [group([ellipse(70), fill("#5cc8ff")])], op, ks(p=list(C), s=anim([(0, [100, 100, 100]), (30, [120, 120, 100]), (60, [100, 100, 100])], EASE_IO))))
    return comp("Radar Pulse", S, S, op, layers)


def location_pin():
    op = 50
    pin = path([(0, 120), (-90, -10), (0, -110), (90, -10)], True, ([[0, 0], [0, 40], [-55, 0], [0, -55]], [[0, 0], [0, -55], [55, 0], [0, 40]]))
    pos = anim([(0, [C[0], C[1] - 200]), (14, [C[0], C[1] - 20]), (22, [C[0], C[1] - 55]), (30, [C[0], C[1] - 20])], [EASE_IO, EASE_OUT, EASE_IO])
    sq = anim([(12, [100, 100, 100]), (15, [115, 85, 100]), (20, [100, 100, 100])], EASE_IO)
    shadow = layer(0, "shadow", [group([ellipse(120, 30), fill("#000000", 35)])], op, ks(p=[C[0], C[1] + 115], s=anim([(0, [30, 30, 100]), (14, [100, 100, 100])], EASE_IO)))
    head = layer(0, "pin", [group([ellipse(70, 70, (0, -15)), fill("#ffffff")]), group([pin, fill("#ff4b4b")])], op, ks(p=pos, s=sq))
    return comp("Location Pin", S, S, op, [head, shadow])


def star_rating():
    op = 60
    layers = []
    for i in range(5):
        x = 56 + i * 100
        s0 = 4 + i * 6
        sc = anim([(s0, [0, 0, 100]), (s0 + 8, [130, 130, 100]), (s0 + 14, [100, 100, 100])], [BACK, EASE_IO])
        layers.append(layer(0, f"star{i}", [group([star(44, 20, 5), fill("#ffc531")])], op, ks(p=[x, C[1]], s=sc, r=anim([(s0, -72), (s0 + 14, 0)], EASE_OUT))))
        layers.append(layer(0, f"slot{i}", [group([star(44, 20, 5), fill("#ffffff", 22)])], op, ks(p=[x, C[1]])))
    return comp("Five Stars", S, S, op, layers)


def scribble_circle():
    W, H = 1920, 1080
    op = 40
    pts = []
    for j in range(15):
        a = -math.pi / 2 + j * (2 * math.pi * 1.08) / 14
        r = 1 + 0.05 * math.sin(j * 1.7)
        pts.append((math.cos(a) * 520 * r, math.sin(a) * 300 * r))
    loop = group([smooth(pts, False, 0.55), stroke("#ff3b30", 18), trim(e=anim([(0, 0), (20, 100)], EASE_IO))])
    return comp("Scribble Circle", W, H, op, [layer(0, "scribble", [loop], op, ks(p=[W / 2, H / 2], r=-4))])


def scribble_underline():
    W, H = 1920, 1080
    op = 36
    pts = [(-560 + i * 80, 14 * math.sin(i * 1.3)) for i in range(15)]
    line = group([smooth(pts, False, 0.5), stroke("#ffd65c", 22), trim(e=anim([(0, 0), (16, 100)], EASE_IO))])
    return comp("Underline", W, H, op, [layer(0, "line", [line], op, ks(p=[W / 2, H * 0.62]))])


def confetti():
    W, H = 1920, 1080
    op = 90
    rnd = random.Random(3)
    cols = ["#ff5c8a", "#ffd65c", "#5cc8ff", "#7cff8a", "#c58cff", "#ffffff"]
    layers = []
    for i in range(48):
        x = rnd.uniform(60, W - 60)
        delay = rnd.randint(0, 30)
        fall = rnd.randint(45, 70)
        drift = rnd.uniform(-160, 160)
        w, h = rnd.uniform(16, 30), rnd.uniform(8, 16)
        shape = rect(w, h, 2) if i % 3 else ellipse(w * 0.7)
        p = anim([(delay, [x, -40]), (delay + fall, [x + drift, H + 40])], LINEAR)
        r = anim([(delay, rnd.uniform(0, 360)), (delay + fall, rnd.uniform(400, 900))], LINEAR)
        flip = anim([(delay, [100, 100, 100]), (delay + 12, [100, 10, 100]), (delay + 24, [100, 100, 100])], EASE_IO)
        layers.append(layer(0, f"bit{i}", [group([shape, fill(cols[i % len(cols)])])], op, ks(p=p, r=r, s=flip)))
    return comp("Confetti", W, H, op, layers)


def emoji_wink():
    op = 60
    face = group([ellipse(380), fill("#ffcc33")])
    eye_l = group([ellipse(44, 62, (-70, -40)), fill("#3a2a12")])
    blink = anim([(20, [100, 100, 100]), (24, [100, 8, 100]), (30, [100, 100, 100])], EASE_IO)
    eye_r = layer(0, "eyeR", [group([ellipse(44, 62), fill("#3a2a12")])], op, ks(p=[C[0] + 70, C[1] - 40], s=blink))
    smile = group([path([(-100, 40), (0, 110), (100, 40)], False, ([[0, 0], [-55, 0], [0, 0]], [[0, 0], [55, 0], [0, 0]])), stroke("#3a2a12", 22)])
    blush = group([ellipse(60, 30, (-125, 45)), ellipse(60, 30, (125, 45)), fill("#ff7a7a", 55)])
    body = ks(p=list(C), s=anim([(0, [0, 0, 100]), (10, [110, 110, 100]), (16, [100, 100, 100])], [BACK, EASE_IO]), r=anim([(16, 0), (26, -8), (36, 6), (44, 0)], EASE_IO))
    head = layer(0, "face", [eye_l, smile, blush, face], op, body)
    eye_r["parent"] = None
    eye_r.pop("parent")
    # parent the blinking eye to the face so it follows the bounce
    eye_r["parent"] = 2
    eye_r["ks"]["p"] = st([70 + C[0] - C[0], -40, 0])
    return comp("Wink", S, S, op, [eye_r, head])


def bell_ring():
    op = 60
    bell = path([(-110, 70), (-80, -30), (0, -120), (80, -30), (110, 70)], True, ([[0, 0], [0, 40], [-60, 0], [0, -60], [0, 0]], [[0, 0], [0, -60], [60, 0], [0, 40], [0, 0]]))
    clapper = group([ellipse(56, 56, (0, 98)), fill("#ffcc33")])
    rim = group([rect(250, 30, 15, (0, 70)), fill("#ffcc33")])
    knob = group([ellipse(36, 36, (0, -128)), fill("#ffcc33")])
    rot = anim([(0, 0), (6, 18), (12, -16), (18, 12), (24, -8), (30, 4), (36, 0)], EASE_IO)
    body = layer(0, "bell", [clapper, rim, knob, group([bell, fill("#ffcc33")])], op, ks(p=[C[0], C[1] - 10], a=[0, -120], r=rot))
    body["ks"]["p"] = st([C[0], C[1] - 130, 0])
    waves = []
    for side in (-1, 1):
        o = anim([(4, 0), (10, 100), (30, 0)], LINEAR)
        w = group([path([(side * 150, -60), (side * 180, 0), (side * 150, 60)], False, ([[0, 0], [0, -30], [0, 0]], [[0, 0], [0, 30], [0, 0]])), stroke("#ffffff", 14, o)])
        waves.append(w)
    return comp("Bell", S, S, op, [body, layer(0, "waves", waves, op, ks(p=list(C)))])


STICKERS = [
    ("sparkle-burst", "Sparkle Burst", "sparkle", sparkle_burst),
    ("heart-pop", "Heart Pop", "love", heart_pop),
    ("confetti", "Confetti", "celebrate", confetti),
    ("done-check", "Done Check", "badge", check_done),
    ("five-stars", "Five Stars", "badge", star_rating),
    ("bell", "Notification Bell", "social", bell_ring),
    ("swipe-up", "Swipe Up", "social", swipe_up),
    ("location-pin", "Location Pin", "badge", location_pin),
    ("radar-pulse", "Radar Pulse", "shape", radar_pulse),
    ("loading", "Loading Ring", "shape", loading_ring),
    ("wink", "Wink", "emoji", emoji_wink),
    ("scribble-circle", "Scribble Circle", "highlight", scribble_circle),
    ("underline", "Scribble Underline", "highlight", scribble_underline),
]

# ------------------------------------------------------------------------ titles (1920x1080)

W, H = 1920, 1080


def lower_third():
    op = 120
    bar_w = anim([(0, [0, 120]), (14, [760, 120]), (100, [760, 120]), (114, [0, 120])], [EASE_OUT, LINEAR, EASE_IO])
    accent_h = anim([(4, [14, 0]), (16, [14, 160]), (98, [14, 160]), (110, [14, 0])], [EASE_OUT, LINEAR, EASE_IO])
    bar = layer(0, "bar", [group([{"ty": "rc", "d": 1, "p": st([0, 0]), "s": bar_w, "r": st(8)}, fill("#101015", 85)])], op, ks(p=[120 + 380, 880]))
    bar["shapes"][0]["it"][-1]["p"] = st([0, 0])
    accent = layer(0, "accent", [group([{"ty": "rc", "d": 1, "p": st([0, 0]), "s": accent_h, "r": st(4)}, fill("#ffd65c")])], op, ks(p=[112, 880]))
    title_o = anim([(10, 0), (20, 100), (100, 100), (108, 0)], LINEAR)
    title_p = anim([(10, [150, 880]), (22, [150, 870])], EASE_OUT)
    title = text_layer(0, "title", "Ad Soyad", 64, "Inter-ExtraBold", "#ffffff", op, ks(p=title_p, o=title_o), justify=0)
    sub_o = anim([(16, 0), (26, 100), (98, 100), (106, 0)], LINEAR)
    sub = text_layer(0, "subtitle", "Unvan / Kanal", 34, "Inter-ExtraBold", "#ffd65c", op, ks(p=[152, 922], o=sub_o), justify=0, tracking=40)
    return comp("Lower Third", W, H, op, [title, sub, accent, bar])


def title_pop():
    op = 90
    sc = anim([(0, [0, 0, 100]), (10, [118, 118, 100]), (16, [96, 96, 100]), (22, [100, 100, 100]), (76, [100, 100, 100]), (86, [0, 0, 100])], [BACK, EASE_IO, EASE_IO, LINEAR, EASE_IO])
    text = text_layer(0, "title", "BAŞLIK", 190, "Anton-Regular", "#ffffff", op, ks(p=[W / 2, H / 2 + 60], s=sc))
    plate_s = anim([(4, [0, 0, 100]), (14, [100, 100, 100]), (76, [100, 100, 100]), (84, [0, 100, 100])], [EASE_OUT, LINEAR, EASE_IO])
    plate = layer(0, "plate", [group([rect(1000, 250, 20), fill("#ff3d6e")])], op, ks(p=[W / 2, H / 2], s=plate_s, r=-3))
    under = layer(0, "underline", [group([path([(-380, 0), (380, 0)]), stroke("#ffd65c", 18), trim(e=anim([(14, 0), (28, 100)], EASE_OUT), s=anim([(74, 0), (84, 100)], EASE_IO))])], op, ks(p=[W / 2, H / 2 + 170]))
    return comp("Title Pop", W, H, op, [text, under, plate])


def subscribe():
    op = 120
    btn_s = anim([(0, [0, 0, 100]), (10, [110, 110, 100]), (16, [100, 100, 100]), (44, [100, 100, 100]), (48, [90, 90, 100]), (54, [100, 100, 100])], [BACK, EASE_IO, LINEAR, EASE_IO, EASE_IO])
    color = {"a": 1, "k": [{"t": 47, "s": hexrgb("#ff0033"), "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}, "h": 1}, {"t": 48, "s": hexrgb("#3a3a40")}]}
    btn = layer(0, "button", [group([rect(620, 150, 75), {"ty": "fl", "c": color, "o": st(100), "r": 1}])], op, ks(p=[W / 2, H * 0.78], s=btn_s))
    fade = anim([(104, 100), (116, 0)], LINEAR)
    btn["ks"]["o"] = fade
    label = text_layer(0, "label", "ABONE OL", 66, "Inter-ExtraBold", "#ffffff", op, ks(p=[W / 2, H * 0.78 + 24], s=btn_s, o=fade), tracking=60)
    cursor_p = anim([(18, [W / 2 + 420, H * 0.78 + 220]), (44, [W / 2 + 120, H * 0.78 + 30]), (70, [W / 2 + 120, H * 0.78 + 30]), (90, [W / 2 + 460, H + 80])], [EASE_IO, LINEAR, EASE_IO])
    hand = path([(0, 0), (0, 90), (22, 68), (40, 108), (56, 100), (38, 62), (68, 62)], True)
    cursor = layer(0, "cursor", [group([hand, stroke("#000000", 6), fill("#ffffff")])], op, ks(p=cursor_p, s=anim([(44, [100, 100, 100]), (48, [85, 85, 100]), (54, [100, 100, 100])], EASE_IO)))
    return comp("Subscribe", W, H, op, [cursor, label, btn])


def chapter():
    op = 120
    line = lambda y, d: layer(0, f"line{y}", [group([path([(-420, 0), (420, 0)]), stroke("#ffffff", 6), trim(s=anim([(d, 50), (d + 18, 0), (98, 0), (110, 50)], [EASE_OUT, LINEAR, EASE_IO]), e=anim([(d, 50), (d + 18, 100), (98, 100), (110, 50)], [EASE_OUT, LINEAR, EASE_IO]))])], op, ks(p=[W / 2, y]))
    o = anim([(12, 0), (26, 100), (96, 100), (108, 0)], LINEAR)
    small = text_layer(0, "kicker", "BÖLÜM 1", 40, "Inter-ExtraBold", "#ffd65c", op, ks(p=[W / 2, H / 2 - 70], o=o), tracking=300)
    big = text_layer(0, "title", "Yeni Başlangıç", 110, "BebasNeue-Regular", "#ffffff", op, ks(p=anim([(14, [W / 2, H / 2 + 70]), (30, [W / 2, H / 2 + 50])], EASE_OUT), o=o), tracking=40)
    return comp("Chapter", W, H, op, [small, big, line(H / 2 - 130, 0), line(H / 2 + 100, 6)])


def countdown():
    op = 90
    layers = []
    for i, n in enumerate(["3", "2", "1"]):
        s0 = i * 30
        sc = anim([(s0, [160, 160, 100]), (s0 + 8, [100, 100, 100]), (s0 + 26, [90, 90, 100]), (s0 + 30, [40, 40, 100])], [EASE_OUT, LINEAR, EASE_IO])
        o = {"a": 1, "k": [{"t": 0, "s": [0], "h": 1}, {"t": s0, "s": [100], "h": 1}, {"t": s0 + 30, "s": [0], "h": 1}, {"t": op, "s": [0]}]}
        layers.append(text_layer(0, f"n{n}", n, 380, "Anton-Regular", "#ffffff", op, ks(p=[W / 2, H / 2 + 140], s=sc, o=o)))
    ring = layer(0, "ring", [group([ellipse(560), stroke("#ffffff", 16, 70), trim(e={"a": 1, "k": [{"t": 0, "s": [100], "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}}, {"t": 30, "s": [0], "h": 1}, {"t": 30, "s": [100], "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}}, {"t": 60, "s": [0], "h": 1}, {"t": 60, "s": [100], "o": {"x": [0], "y": [0]}, "i": {"x": [1], "y": [1]}}, {"t": 90, "s": [0]}]})], r=-90)], op, ks(p=[W / 2, H / 2]))
    return comp("Countdown", W, H, op, layers + [ring])


def quote_card():
    op = 150
    card_s = anim([(0, [100, 0, 100]), (14, [100, 100, 100]), (134, [100, 100, 100]), (146, [100, 0, 100])], [EASE_OUT, LINEAR, EASE_IO])
    card = layer(0, "card", [group([rect(1300, 420, 30), fill("#ffffff", 92)])], op, ks(p=[W / 2, H / 2], s=card_s))
    mark = layer(0, "mark", [group([ellipse(110), fill("#ff3d6e")])], op, ks(p=[W / 2 - 650, H / 2 - 210], s=anim([(10, [0, 0, 100]), (20, [100, 100, 100]), (134, [100, 100, 100]), (142, [0, 0, 100])], [BACK, LINEAR, EASE_IO])))
    q = text_layer(0, "quote-mark", "“", 140, "Anton-Regular", "#ffffff", op, ks(p=[W / 2 - 650, H / 2 - 160], s=anim([(10, [0, 0, 100]), (20, [100, 100, 100]), (134, [100, 100, 100]), (142, [0, 0, 100])], [BACK, LINEAR, EASE_IO])))
    o = anim([(16, 0), (28, 100), (128, 100), (138, 0)], LINEAR)
    body = text_layer(0, "quote", "Hayal edebiliyorsan yapabilirsin.", 72, "Inter-ExtraBold", "#15151a", op, ks(p=[W / 2, H / 2 + 10], o=o))
    who = text_layer(0, "author", "— İsim", 40, "Inter-ExtraBold", "#ff3d6e", op, ks(p=[W / 2, H / 2 + 110], o=o))
    return comp("Quote", W, H, op, [q, mark, body, who, card])


TITLES = [
    ("lower-third", "Lower Third", "titles", lower_third),
    ("title-pop", "Title Pop", "titles", title_pop),
    ("chapter", "Chapter Title", "titles", chapter),
    ("quote", "Quote Card", "titles", quote_card),
    ("subscribe", "Subscribe Button", "social", subscribe),
    ("countdown", "Countdown 3-2-1", "titles", countdown),
]


def write_pack(folder, pack_id, name, description, entries, kind):
    src = ROOT / "src" / folder
    (src / "lottie").mkdir(parents=True, exist_ok=True)
    manifest = {
        "format": "xenocut-pack/1",
        "version": "1.0.0",
        "author": "XenoCut contributors",
        "license": "CC0-1.0",
        "homepage": "https://github.com/sxmsoft/xenocut/tree/main/catalog",
        "id": pack_id,
        "name": name,
        "description": description,
        "lottie": [],
    }
    for eid, ename, cat, fn in entries:
        data = fn()
        (src / "lottie" / f"{eid}.json").write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n")
        manifest["lottie"].append({"id": eid, "name": ename, "category": cat, "file": f"lottie/{eid}.json", "kind": kind})
    (src / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(folder, len(entries))


if __name__ == "__main__":
    write_pack("lottie-stickers", "xenocut.lottie-stickers", "Animated Stickers",
               "Thirteen looping Lottie stickers: sparkles, hearts, confetti, badges, social prompts and hand-drawn highlights.", STICKERS, "overlay")
    write_pack("lottie-titles", "xenocut.lottie-titles", "Animated Titles",
               "Six Lottie titles with editable text: lower third, title pop, chapter, quote card, subscribe button and a 3-2-1 countdown.", TITLES, "text")

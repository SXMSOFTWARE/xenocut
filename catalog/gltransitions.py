#!/usr/bin/env python3
"""Writes the manifests of the gl-transitions packs (catalog/src/gl-*/manifest.json) from the
vendored shaders in catalog/vendor/gl-transitions (MIT, https://github.com/gl-transitions).
build.py copies the .glsl files and the MIT licence into the packs. Run after updating the
vendored copy; the four excluded upstream shaders need extra textures or are not MIT.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
VENDOR = ROOT / "vendor" / "gl-transitions"

# file stem -> (pack, category, display name)
E, M, G, S = "essentials", "motion", "glitch", "shapes"
TABLE = {
    "fade": (E, "basic", "Crossfade"), "fadecolor": (E, "basic", "Fade Through Color"),
    "fadegrayscale": (E, "basic", "Fade Through Gray"), "HSVfade": (E, "basic", "HSV Fade"),
    "colorphase": (E, "light", "Color Phase"), "ColourDistance": (E, "basic", "Colour Distance"),
    "multiply_blend": (E, "light", "Multiply Blend"), "Overexposure": (E, "light", "Overexposure"),
    "Dreamy": (E, "smooth", "Dreamy"), "DreamyZoom": (E, "zoom", "Dreamy Zoom"),
    "LinearBlur": (E, "smooth", "Linear Blur"), "DefocusBlur": (E, "smooth", "Defocus Blur"),
    "Directional": (E, "slide", "Push"), "DirectionalScaled": (E, "slide", "Push Scaled"),
    "directional-easing": (E, "slide", "Push Eased"), "directionalwipe": (E, "wipe", "Soft Wipe"),
    "wipeLeft": (E, "wipe", "Hard Wipe Left"), "wipeRight": (E, "wipe", "Hard Wipe Right"),
    "wipeUp": (E, "wipe", "Hard Wipe Up"), "wipeDown": (E, "wipe", "Hard Wipe Down"),
    "LeftRight": (E, "wipe", "Left Right"), "TopBottom": (E, "wipe", "Top Bottom"),
    "Slides": (E, "slide", "Slides"), "x_axis_translation": (E, "slide", "Sideways"),
    "splitSlideInHorizontal": (E, "slide", "Split In ↔"), "splitSlideInVertical": (E, "slide", "Split In ↕"),
    "splitSlideOutHorizontal": (E, "slide", "Split Out ↔"), "splitSlideOutVertical": (E, "slide", "Split Out ↕"),
    "splitSlideInOutHorizontal": (E, "slide", "Split Swap ↔"), "splitSlideInOutVertical": (E, "slide", "Split Swap ↕"),
    "coord-from-in": (E, "smooth", "Melt In"),
    "SimpleZoom": (E, "zoom", "Zoom Through"), "SimpleZoomOut": (E, "zoom", "Zoom Out"),
    "CrossZoom": (E, "zoom", "Cross Zoom"), "ZoomInCircles": (E, "zoom", "Zoom Circles"),
    "ZoomLeftWipe": (E, "zoom", "Zoom Wipe Left"), "ZoomRigthWipe": (E, "zoom", "Zoom Wipe Right"),
    "zoomInOut": (E, "zoom", "Zoom In Out"), "scale-in": (E, "zoom", "Scale In"), "squeeze": (E, "zoom", "Squeeze"),
    "cube": (M, "motion", "Cube"), "BookFlip": (M, "motion", "Book Flip"), "SimpleFlip": (M, "motion", "Flip"),
    "GridFlip": (M, "motion", "Grid Flip"), "Fold": (M, "motion", "Fold"), "doorway": (M, "motion", "Doorway"),
    "swap": (M, "motion", "Swap"), "Revolve_Left": (M, "motion", "Revolve"), "rotateTransition": (M, "motion", "Rotate"),
    "rotate_scale_fade": (M, "motion", "Rotate Fade"), "RotateScaleVanish": (M, "motion", "Spin Away"),
    "Rolls": (M, "motion", "Roll"), "Bounce": (M, "motion", "Bounce"), "Swirl": (M, "motion", "Swirl"),
    "morph": (M, "smooth", "Morph"), "crosswarp": (M, "smooth", "Cross Warp"), "directionalwarp": (M, "smooth", "Warp"),
    "tangentMotionBlur": (M, "motion", "Motion Blur"), "flyeye": (M, "motion", "Fly Eye"), "ripple": (M, "motion", "Ripple"),
    "WaterDrop": (M, "motion", "Water Drop"), "polar_function": (M, "shape", "Polar"), "angular": (M, "shape", "Angular"),
    "pinwheel": (M, "shape", "Pinwheel"), "kaleidoscope": (M, "pattern", "Kaleidoscope"),
    "powerKaleido": (M, "pattern", "Power Kaleido"), "Radial": (M, "shape", "Radial"), "wind": (M, "motion", "Wind"),
    "TilesWave": (M, "pattern", "Tiles Wave"), "ButterflyWaveScrawler": (M, "motion", "Butterfly Wave"),
    "CrazyParametricFun": (M, "pattern", "Parametric"),
    "GlitchDisplace": (G, "glitch", "Glitch Displace"), "GlitchMemories": (G, "glitch", "Glitch Memories"),
    "StripDatamoshGlitch": (G, "glitch", "Datamosh Strips"), "parametric_glitch": (G, "glitch", "Glitch"),
    "TVStatic": (G, "glitch", "TV Static"), "old_tv_lost_signal": (G, "glitch", "Lost Signal"),
    "randomNoisex": (G, "glitch", "Noise"), "static_wipe": (G, "glitch", "Static Wipe"), "StaticFade": (G, "glitch", "Static Fade"),
    "DoomScreenTransition": (G, "glitch", "Melt Down"), "Drop_Zone_Flicker": (G, "light", "Flicker"),
    "FilmBurn": (G, "light", "Film Burn"), "burn": (G, "light", "Burn"), "burn0": (G, "light", "Burn Through"),
    "undulatingBurnOut": (G, "light", "Burn Out"), "luminance_melt": (G, "light", "Luminance Melt"),
    "perlin": (G, "glitch", "Perlin"), "dissolve": (G, "glitch", "Dissolve"), "pixelize": (G, "glitch", "Pixelize"),
    "mosaic_transition": (G, "pattern", "Mosaic"), "Mosaic": (G, "pattern", "Mosaic Shift"),
    "AdvancedMosaic": (G, "pattern", "Mosaic Pro"), "BlockDissolve": (G, "glitch", "Block Dissolve"),
    "hexagonalize": (G, "pattern", "Hexagons"), "EdgeTransition": (G, "light", "Edges"),
    "circle": (S, "shape", "Circle"), "circleopen": (S, "shape", "Circle Open"), "CircleCrop": (S, "shape", "Circle Crop"),
    "heart": (S, "shape", "Heart"), "StarWipe": (S, "shape", "Star"), "cannabisleaf": (S, "shape", "Leaf"),
    "Rectangle": (S, "shape", "Rectangle"), "RectangleCrop": (S, "shape", "Rectangle Crop"), "Box": (S, "shape", "Box"),
    "BowTieHorizontal": (S, "shape", "Bow Tie ↔"), "BowTieVertical": (S, "shape", "Bow Tie ↕"),
    "BowTieWithParameter": (S, "shape", "Bow Tie"), "HorizontalClose": (S, "shape", "Close ↔"),
    "HorizontalOpen": (S, "shape", "Open ↔"), "VerticalClose": (S, "shape", "Close ↕"), "VerticalOpen": (S, "shape", "Open ↕"),
    "windowblinds": (S, "pattern", "Window Blinds"), "windowslice": (S, "pattern", "Window Slice"),
    "chessboard": (S, "pattern", "Chessboard"), "crosshatch": (S, "pattern", "Crosshatch"),
    "PolkaDotsCurtain": (S, "pattern", "Polka Dots"), "PuzzleRight": (S, "pattern", "Puzzle"),
    "randomsquares": (S, "pattern", "Random Squares"), "squareswire": (S, "pattern", "Squares Wire"),
    "fragment": (S, "pattern", "Fragments"),
}

PACKS = {
    E: ("xenocut.gl-essentials", "Transitions: Essentials", "Crossfades, pushes, splits, blurs and zooms: everyday GLSL transitions from the gl-transitions collection."),
    M: ("xenocut.gl-motion", "Transitions: 3D & Motion", "Cubes, flips, folds, swirls, ripples and warps from the gl-transitions collection."),
    G: ("xenocut.gl-glitch", "Transitions: Glitch & Light", "Glitches, static, film burns, flickers, mosaics and dissolves from the gl-transitions collection."),
    S: ("xenocut.gl-shapes", "Transitions: Shapes & Patterns", "Circles, hearts, stars, bow ties, blinds, chessboards and puzzles from the gl-transitions collection."),
}


def header(text: str, key: str):
    m = re.search(rf"^\s*//\s*{key}\s*:?\s*(.+)$", text, re.I | re.M)
    return m.group(1).strip() if m else None


def slug(stem: str) -> str:
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", stem)
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    stems = sorted(p.stem for p in VENDOR.glob("*.glsl"))
    missing = [s for s in stems if s not in TABLE]
    extra = [s for s in TABLE if s not in stems]
    if missing or extra:
        raise SystemExit(f"unmapped: {missing}, not vendored: {extra}")
    for key, (pid, name, desc) in PACKS.items():
        entries = []
        for stem in sorted((s for s in stems if TABLE[s][0] == key), key=lambda s: TABLE[s][2].lower()):
            text = (VENDOR / f"{stem}.glsl").read_text()
            entry = {"id": slug(stem), "name": TABLE[stem][2], "category": TABLE[stem][1], "file": f"transitions/{stem}.glsl"}
            if (a := header(text, "author")):
                entry["author"] = a[:120]
            entry["license"] = header(text, "license") or "MIT"
            entries.append(entry)
        manifest = {
            "format": "xenocut-pack/1",
            "version": "1.0.0",
            "author": "gl-transitions contributors",
            "license": "MIT",
            "homepage": "https://github.com/gl-transitions/gl-transitions",
            "id": pid,
            "name": name,
            "description": desc,
            "transitions": entries,
        }
        out = ROOT / "src" / pid.split(".", 1)[1]
        out.mkdir(parents=True, exist_ok=True)
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        print(f"{pid}: {len(entries)} transitions")


if __name__ == "__main__":
    main()

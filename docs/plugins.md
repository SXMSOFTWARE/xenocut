# XenoCut plugins

XenoCut plugins are **packs**: a JSON manifest plus asset files. A pack holds **no code**. Every
entry is checked against the same building blocks the built-in effects, animations and text
styles use, so a pack can't do anything the built-ins can't. Packs work the same on desktop
(Windows, Linux) and Android.

A pack can add:

| Content | Where it shows up | Stored in the project as |
| --- | --- | --- |
| **LUTs** (`.cube`) | Color panel → *Clip LUT*, with a strength slider | the LUT file path + strength |
| **Effect looks** (stacks of built-in effects) | Effects → *Plugins* tab | ordinary effect layers |
| **Clip animations** (In / Out / Combo) | Animation panel, as tiles with a puzzle badge | the full animation spec |
| **Text presets** | Text → *Plugin styles* (new text and the Style tab) | ordinary text style fields |

Applying an entry copies what it needs into the project. A project keeps its look after you
disable or remove the pack. LUTs are the exception: they are referenced by path. If the LUT file
is gone, export skips it with a warning and preview shows the clip ungraded.

## Installing

Open **Plugins** from the Home page, Settings, or a panel's *Get more* tile.

* **Catalog**: the curated packs (see [catalog/](../catalog/README.md)). *Install* downloads the
  pack and checks its SHA-256 against the catalog. The catalog and all its packs are also
  **built into the app**, so the page works offline and installs without the network. When the
  published catalog is reachable, it is used instead (newer versions show an *Update* button).
* **Install from file**: `.xcpack`, `.zip`, or a bare `.cube` file. A bare LUT is wrapped into a
  one-LUT pack named after the file. On desktop you can also drop files on the Plugins page.
* **Library**: lists installed packs with author, version, license, size and contents. Each pack
  has an on/off switch (a disabled pack disappears from the panels), details, a homepage link and
  *Remove*.

Packs live in `<app data>/plugins/<id>/`. Their enabled state is in
`<app data>/plugins/state.json`.

## Pack format (`xenocut-pack/1`)

A pack is a zip archive (extension `.xcpack`) with `manifest.json` at its root, or inside one
top-level folder.

```json
{
  "format": "xenocut-pack/1",
  "id": "com.example.my-looks",
  "name": "My Looks",
  "version": "1.0.0",
  "author": "Jane Doe",
  "license": "CC-BY-4.0",
  "homepage": "https://example.com/my-looks",
  "description": "What the pack contains.",
  "thumbnail": "thumb.jpg",
  "luts": [{ "id": "warm", "name": "Warm", "file": "luts/warm.cube" }],
  "effects": [{ "id": "moody", "name": "Moody", "category": "Mood", "stack": [["contrast", 0.3], ["saturation", -0.35], ["vignette", 0.5]] }],
  "animations": [
    { "id": "drop-in", "name": "Drop In", "slot": "in", "duration": 0.7, "spec": { "ty": -0.6, "alpha": true, "alphaSpan": 0.3, "curve": "bounce" } },
    { "id": "breathe", "name": "Breathe", "slot": "combo", "duration": 3, "spec": { "terms": [["s", 0.035, "bump"]] } }
  ],
  "textPresets": [{ "id": "bold", "name": "Bold Caption", "style": { "font": "montserrat", "weight": 800, "size": 72, "color": "#ffffff", "stroke": 6, "strokeColor": "#000000" } }]
}
```

### Fields

| Field | Rules |
| --- | --- |
| `format` | must be `xenocut-pack/1` |
| `id` | 2–64 chars, `a-z 0-9 . _ -`, starts with a letter or digit. Reverse-DNS is recommended. Installing the same id again replaces the old pack (that is how updates work). |
| `name`, `version`, `license` | required. `license` is an SPDX id and is shown in the Library. |
| `author` ≤ 96 chars, `description` ≤ 600 chars, `homepage` must be `https://` | optional |
| `thumbnail` | optional image in the pack (`png`, `jpg`, `webp`), shown on the Library card |
| entry `id` | `A-Z a-z 0-9 _ -`, ≤ 48 chars, unique per kind; entry `name` ≤ 48 chars |

### LUTs

Standard Adobe/Resolve `.cube` 3D LUTs, `LUT_3D_SIZE` 2–65, with an optional
`DOMAIN_MIN` / `DOMAIN_MAX`. 1D LUTs are not supported. Preview applies the LUT in a WebGL2
canvas (trilinear interpolation). Export bakes the LUT mixed at the chosen strength and runs it
through FFmpeg `lut3d` (tetrahedral), so preview and export look the same.

### Effect looks

`stack` is 1–12 `[kind, amount]` pairs using the built-in primitives:
`brightness contrast saturation temperature` (amount −1…1) and
`bw sepia invert sharpen blur rgbSplit vignette grain scanlines letterbox mirror flip zoomIn zoomOut shake flash punch hitShake fadeIn fadeOut`
(amount 0…1). Beat-hit kinds are skipped when a look is applied. Applying a look replaces those
kinds on the clip, or adds a new effect layer when no clip is selected.

### Animations

`slot` is `in`, `out` or `combo`. `duration` is optional, 0.1–10 s.

* **In / Out** (`out` plays the same shape in reverse). Fields:
  * `s` start scale (default 1), `tx` / `ty` offset in frame widths/heights, `rot` degrees;
  * `alpha` fades in, over the first `alphaSpan` of the window;
  * `curve`: one of `ease back bounce linear`;
  * `fx`: `[kind, amount, from, to]` effect bursts, where from/to are fractions of the window.
* **Combo** (loops over the whole clip): `terms` is a list of `[param, amount, wave]`, where
  param is `s tx ty rot` and wave is `sin bump beat turn ramp ramp1`. `fx` works as above, with
  fractions of the clip.

Unknown fields, curves, waves or effect kinds reject the pack.

### Text presets

`style` is a flat object of text style fields. Only known fields with valid values are kept:

* `font` must be a bundled font: `inter montserrat bebas anton oswald playfair caveat bangers`;
* `background` is one of `none box pill band`, and `align` is one of `left center right`;
* colours are `#rrggbb` or `#rrggbbaa`, and `color2` (gradient) may be `null`;
* numbers are clamped to the editor's ranges: `weight` 100–900, `size` 8–400, `stroke` 0–40,
  `shadow`/`glow`/`bgOpacity` 0–1, `x`/`y` 0–1, `width` 0.1–1, `spacing` −0.2–1,
  `lineHeight` 0.6–3.

A preset keeps the text's current position unless it sets `x`/`y`.

### Themes

Settings → Theme and layout exports the current theme as a one-theme pack, and the same screen
imports theme packs. A theme entry looks like this:

```json
"themes": [{ "id": "night-blue", "name": "Night blue", "layout": "modern", "density": "compact",
  "radius": 0.6, "fontScale": 1.0, "accent": "#4f8cff",
  "tokens": { "--bg": "#10141c", "--surface-1": "#161b25", "--text": "#e9eef7" } }]
```

* `layout` is one of `xenocut modern basic classic`, and `density` is one of
  `compact normal comfortable`.
* `radius` is a corner-radius multiplier from 0 to 1.5. `fontScale` runs from 0.85 to 1.25.
* `accent` is empty or `#rrggbb`.
* `tokens` holds at most 64 CSS custom properties.
  * Names match `--[a-z0-9-]` and are at most 42 characters.
  * Values are colours, numbers or lengths: letters, digits and ` #%(),.+-/`, up to 160
    characters.
  * Values must not contain `url`, `expression`, `image-set` or `attr`.
* Setting `--bg` makes the theme "solid", which turns off the glass and ambient look.
* On phones, themes change colours and density but keep the phone layout.

## Sandbox and limits

* No scripts, shaders, binaries or HTML. Allowed files: `json cube png webp jpg jpeg txt md`.
  Anything else rejects the pack.
* At most 400 files; 24 MB per file and 64 MB per pack (also enforced while downloading);
  at most 500 entries.
* Paths must be relative, with no `..`, no absolute paths and at most 4 levels deep. Archives
  are unpacked into a staging folder and checked before anything is moved into place (zip-slip
  safe).
* The app reads LUT files only from inside the plugin folder.
* Catalog downloads are `https` only and need a matching SHA-256.
* Text styles are re-sanitised in the UI, and animation specs and effect stacks are re-validated
  by the renderer and the exporter.

## The catalog

`catalog/index.json` (`xenocut-catalog/1`) lists packs:

```json
{ "format": "xenocut-catalog/1", "packs": [ { "id": "…", "name": "…", "version": "1.0.0", "author": "…", "license": "CC0-1.0",
  "description": "…", "url": "https://…/packs/<id>-<version>.xcpack", "sha256": "…", "bytes": 905833,
  "thumbnail": "https://…/thumbs/<id>.jpg", "contents": { "luts": 6 } } ] }
```

`python3 catalog/build.py` rebuilds the packs and the index reproducibly. The app embeds the
index, the packs and the thumbnails at compile time (`src-tauri/src/plugins.rs`,
`BUNDLED_PACKS`). `cargo test --lib plugins` checks that the embedded copy matches `catalog/` and
that every pack installs. Only permissively licensed content is accepted (CC0, CC-BY, MIT, BSD,
Apache).

## Not in v0.6 (planned for v0.7)

These formats are rejected with a clear "planned for v0.7" message:

* **Transitions**, including **GLSL gl-transitions**. XenoCut does not have a transition engine
  between clips yet. Shipping shader transitions without one would be half-working.
* **Lottie** animated titles and stickers.
* **OpenFX** (desktop only): a native host process with parameter UI and crash isolation, tested
  with Natron's openfx-misc, plus **frei0r** filters on Linux. Native plugins run code, so they
  will run outside the editor process and never on Android.

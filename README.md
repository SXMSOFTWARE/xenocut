# XenoCut

XenoCut is a light video editor (Tauri 2 + React) for Linux, Windows and Android (arm64 APK). It has a home screen with projects, a multi-track editor, MP4 export, and one-click tools. The first one-click tool is **Music Swap**: keep the voices in a video and replace the background music with a song file you already have.

Everything runs locally. XenoCut never calls Suno or any other music API: you pick a downloaded `mp3`/`wav`/`m4a`/`flac` file.

## What is in the app

| Page | What it does |
| --- | --- |
| **Home** | New project (name, aspect 16:9 / 9:16 / 1:1 / 4:5, 720p–4K, 24/30/60 fps), open an `.xcut` file, recent projects with thumbnails, Quick Tools. |
| **Editor** | Media bin (import button or drag-drop; video, audio, image; filter chips), preview with transport and timecode, inspector (trim, speed, volume, opacity, fades, split/delete), timeline. Undo/redo, save, autosave. |
| **Export** | MP4 (H.264 + AAC). Resolution (project, 720p, 1080p, 1440p, 4K), fps, quality (fast/balanced/high). Real progress from FFmpeg, cancel, overwrite warning, file size and time when done, "Open folder". |
| **Music Swap** | 1) choose a video, 2) separate vocals and music on the device (UVR MDX-Net, ONNX), 3) choose your song, 4) set vocal/music gain, offset, fades, loop, preview the mix, render. The result can be opened as a new project in the editor. |
| **Settings** | Export and project folders, autosave, language (Türkçe default, English), performance mode (on by default on Linux), cache size/clear, vocal model download/delete, version. |

### Editor panels

| Panel | What it does |
| --- | --- |
| **Text** | 12 styled presets, bundled OFL fonts, in/out animations, drag on the preview. |
| **Captions** | On-device Whisper (tiny/base/small), speech-aligned cues, styles, SRT/VTT/LRC import and export. |
| **Lyrics** | LRC/SRT import or pasted text, tap-to-sync while playing, karaoke styles, LRC export. |
| **Effects** | Per-clip colour, look and motion effects, 12 one-click edit presets, beat hits (flash, zoom punch, hit shake). |
| **Beat sync** | Finds the song's tempo and beats on the device, shows them on the ruler, snaps to them, cuts every 1/2/4/8 beats, builds a beat montage from your clips and adds hits on the cuts. |

The layout button in the bottom bar switches between the reference layout, panel on the left, a large timeline and a preview-only focus view. Drag the timeline's top edge or the panel's inner edge to resize them; double-click resets.

### Timeline

- Video, audio, and music tracks. Add tracks from the toolbar; drop media on the empty row under the last track to create one.
- Move clips across tracks, trim either edge, split at the playhead (S), delete (Delete/Backspace).
- Snapping to clip edges and the playhead (toggle in the toolbar).
- Zoom slider, Ctrl+wheel zoom around the cursor, zoom to fit.
- Filmstrips for video, waveforms for audio, colored strips per track kind.
- The top video track is drawn on top, in both the preview and the export.

### Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| K / L | Pause / play |
| J | Pause and step back 1 s |
| ← / → | One frame (Shift: one second) |
| ↑ / ↓ | Previous / next clip edge |
| Home / End | Start / end |
| Ctrl + / Ctrl − | Zoom the timeline |
| S | Split at playhead |
| Delete / Backspace | Delete selected clips |
| Esc | Clear selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Save |
| Ctrl+E | Export |

## Project files

A project is a JSON `.xcut` file with settings, media (absolute paths), tracks, and clips. Thumbnails, filmstrips, and waveforms are cached in the app cache directory and can be cleared in Settings.

## Development

Prerequisites: Node.js 20+, Rust stable ([rustup](https://rustup.rs)), and the system webview. On Ubuntu 24.04:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf libssl-dev libxdo-dev
```

```bash
npm install
npm run ffmpeg:fetch      # downloads the FFmpeg sidecar into src-tauri/binaries/
npm run tauri dev         # desktop app with the real backend
npm run tauri build       # installers
npm run build             # typecheck + frontend bundle only
cargo test --manifest-path src-tauri/Cargo.toml
```

GitHub Actions (`.github/workflows/build.yml`) builds an AppImage and `.deb` on Ubuntu and NSIS/MSI installers on Windows for pushes to `main` and `v*` tags.

### Headless harness

`src-tauri/examples/harness.rs` drives the real backend code without a window:

```bash
export XENOCUT_FFMPEG=$PWD/src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu
# probe files and build thumbnails/filmstrips/waveforms, write a manifest
cargo run --manifest-path src-tauri/Cargo.toml --example harness -- assets /tmp/xc-cache /tmp/manifest.json a.mp4 b.mp3
# render a project exactly like the Export dialog
cargo run --manifest-path src-tauri/Cargo.toml --example harness -- export project.xcut out.mp4 1280 720 30
```

### Browser mode (development only)

`npm run dev` in a plain browser uses `src/dev/devBackend.ts`, which is loaded only when `import.meta.env.DEV` is true and is not part of production builds. It serves media data produced by the harness (above), so screenshots show real thumbnails and waveforms:

```bash
XENOCUT_DEV_FS_ALLOW=/tmp:/path/to/media VITE_XENOCUT_FIXTURES=/tmp/manifest.json npx vite
```

Export, stem separation, and model download need the desktop app and say so in browser mode.

## Architecture

```text
src/
  pages/home        Home, New Project dialog
  pages/editor      TopBar, MediaBin, Preview, Inspector, ExportDialog, timeline/*
  pages/music       Music Swap wizard
  pages/settings    Settings
  engine/           playback clock (rAF; the playhead is moved through refs, not React state)
  project/          types, pure timeline operations, actions (import, add, save, autosave)
  store/            zustand stores: project (with undo history), playback, settings, recent, ui
  i18n/             tr (default) and en dictionaries
  styles/           tokens, base, ui, per-page CSS (no CSS framework)
src-tauri/src/
  app.rs            settings store, projects, media probe/assets, cache, export, model commands
  media.rs          FFmpeg probe, thumbnails, filmstrips, waveform images
  project.rs        project model shared with the frontend
  export.rs         timeline → FFmpeg filter graph, progress, cancel
  audio/            stem separation (ort + MDX-Net), local music import, mix render
```

Pages other than Home are lazy-loaded. Performance mode removes blur and glow effects; large `backdrop-filter`s are not used anywhere.

## FFmpeg sidecar

`src-tauri/tauri.conf.json` lists `binaries/ffmpeg` as an `externalBin`. `scripts/fetch-ffmpeg.sh` downloads a static GPL build from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) for Linux x86_64/arm64 or Windows x64. Shipping it means complying with the GPL. At runtime the lookup order is `XENOCUT_FFMPEG`, the executable's directory, `src-tauri/binaries/ffmpeg-<triple>`, then `ffmpeg` on `PATH`.

### Android

Android does not use the sidecar. `scripts/build-android-ffmpeg.sh` builds an arm64 FFmpeg executable (with x264) with the NDK and installs it as `src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libffmpeg.so`, so it lands in the app's native library directory and runs as a subprocess there. Build the APK with `npx tauri android build --apk --target aarch64` (JDK 17, Android SDK, NDK 27). `.cargo/config.toml` enables the ARMv8.2 `fp16` feature for that target because candle's half-precision kernels need it. Vocal separation (ONNX Runtime) is desktop-only.

## Vocal model

Separation uses UVR’s MDX-Net **Voc_FT** weights through ONNX Runtime (`ort`). The file is not in the installer. The first separation downloads it into the app data directory (`…/xenocut/models/`) and shows progress. A cancelled download stops between reads. The checksum is checked before the file is used.

- File: `UVR-MDX-NET-Voc_FT.onnx`
- URL: `https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx`
- SHA-256: `534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111`
- UVR `model_data.json` key (MD5 of the last 10,000 × 1024 bytes): `77d07b2667ddf05b9e3175941b4454a0`
- Parameters: 44.1 kHz, `n_fft` 7680, hop 1024, `dim_f` 3072, `dim_t` 256, overlap 0.25, compensate 1.021, primary stem vocals

License: the UVR project and the notabilia mirror of these public weights are MIT. Credit Anjok07, KimberleyJSN, and aufr33. The architecture is KUIELab-MDX-Net (arXiv 2111.12203). Set `XENOCUT_MODEL` to a file that already matches the SHA-256 if you do not want the app to download it.

Audio is split into overlapping windows (`hop * (dim_t - 1)` samples, with the UVR tail pad) so a long file does not become one spectrogram. Inference runs on a blocking thread, off the UI. Cancel is honored between windows, not in the middle of a single ONNX run.

To time a three-second clip against a cached model:

```bash
XENOCUT_MODEL=/path/to/UVR-MDX-NET-Voc_FT.onnx \
  cargo test --manifest-path src-tauri/Cargo.toml --lib separates_and_mixes_a_short_clip -- --ignored --nocapture
```

## Known gaps

- J steps back one second; there is no reverse shuttle.
- Preview plays the audio of the top visible video clip and the audio/music tracks; audio from lower, covered video tracks is heard only in the export.
- Preview volume is capped at 100% (the export honors values above 100%). The same holds for the Music Swap preview.
- Dragging moves one clip; multi-clip move is not implemented yet.
- No transitions yet. The silence cutter and vertical reframe Quick Tools are marked "Yakında".
- Android: arm64 only; vocal separation is not available there, and the APK is signed with a debug key.

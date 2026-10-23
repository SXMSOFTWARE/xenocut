# XenoCut

XenoCut is a lightweight video editor for Windows, Linux, and Android. The editor shell plays a local video on a timeline. The one-click audio flow extracts that audio, separates vocals from the background on this machine, imports a song you already downloaded, and writes a new video with the original picture and the mixed soundtrack.

Music is a local file (`mp3`, `wav`, or `m4a`). XenoCut does not call Suno, and it does not ask for an API key.

The empty project opens on **Silent Passage**, a generated still, so the editor looks finished before a file is imported.

## Run the UI

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run dev` is the fast path for layout and playback. In a browser the file picker is the page’s file input, so Rust never sees a filesystem path. Separate, mix, and render stay in the desktop app and show that when you press them. You can still import a song in the browser and listen to that file.

```bash
npm run build
```

Typechecks with `tsc` and writes `dist/`.

## Desktop (Windows and Linux)

Prerequisites:

- Node.js 20 or newer
- Rust (stable), via [rustup](https://rustup.rs)
- A system webview

Windows 10 and 11 already include WebView2. On Ubuntu 24.04:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf libssl-dev libxdo-dev
```

Other distributions: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Fetch the FFmpeg sidecar once, then start the app:

```bash
npm install
npm run ffmpeg:fetch
npm run tauri dev
npm run tauri build
```

`tauri dev` starts Vite on port 43123 and opens the native window. Import uses the dialog plugin, so the Rust commands receive real paths. The window is a dark canvas; the editor sits centered on it and goes fullscreen when the window is narrow, which is the Android layout.

Check the Rust crate:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

That runs the filter-graph tests, the chunking tests, the STFT round-trip, and a two-second FFmpeg mix when the sidecar is present. The vocal-model pass is ignored by default (see below).

## FFmpeg sidecar

`src-tauri/tauri.conf.json` lists `binaries/ffmpeg` as an `externalBin`. Tauri looks for `ffmpeg-<target-triple>` next to the binary (`.exe` on Windows). `scripts/fetch-ffmpeg.sh` (`npm run ffmpeg:fetch`) downloads a static build for the host triple, or for a triple you pass:

| Triple | Source |
| --- | --- |
| `x86_64-unknown-linux-gnu` | John Van Sickle amd64 static |
| `aarch64-unknown-linux-gnu` | John Van Sickle arm64 static |
| `x86_64-pc-windows-msvc` | BtbN `ffmpeg-master-latest-win64-gpl.zip` |

Those builds are GPL-3.0-or-later. Shipping the binary means complying with that license. The files land in `src-tauri/binaries/` and are gitignored.

At runtime the lookup order is `XENOCUT_FFMPEG`, the executable’s directory, `src-tauri/binaries/ffmpeg-<triple>`, then `ffmpeg` on `PATH`.

### Android

Android does not use this sidecar. `ffmpeg_binary()` returns a clear error on that target. The plan is a prebuilt FFmpeg (an ffmpeg-kit successor, or a static library built with the NDK) linked into the Rust crate and called through the same `extract_wav` / `run` helpers. That library is not linked in this tree. `src-tauri/gen/android` is also absent until `npm run android:init` runs on a machine with the Android SDK and NDK.

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

## Architecture

```text
src/
  components/     EditorShell, IconRail, PreviewArea, PromptPanel,
                  Timeline, ClipStrip, TransportBar, QuickSettings,
                  AudioEditingFlow
  store/          Zustand editor state
  lib/            thumbnails, clip math, Tauri audio client
  context/        playback, seek, and the file picker
src-tauri/src/audio/
  traits.rs       StemSeparator, MusicProvider, Renderer
  separator.rs    OnnxMdxSeparator (ort + MDX-Net Voc_FT)
  stft.rs         reflect-pad STFT used by the separator
  chunk.rs        window and overlap math
  model.rs        first-use download and checksum
  music.rs        local-file MusicProvider
  graph.rs        FFmpeg filter graph for the mix
  ffmpeg.rs       sidecar lookup, progress parser, process runner
  renderer.rs     mix + copy the video stream
  commands.rs     invoke handlers and audio-progress events
scripts/fetch-ffmpeg.sh
```

The preview is a `<video>` element. Transport buttons, the scrubber, and the playhead share one clock. With no file loaded, playback moves the playhead across the demo timeline. Frames for the clip strips are drawn to a canvas in the page.

Rust commands:

| Command | What it does |
| --- | --- |
| `audio_separate_stems` | Extract 44.1 kHz stereo wav, download the model if needed, write `vocals.wav` and `instrumental.wav` |
| `audio_import_music` | Check that the path exists and is mp3, wav, or m4a. No copy, no network |
| `audio_mix_render` | Mix vocals and the imported song, copy the video stream, write AAC audio |
| `audio_cancel` | Stop the current job between chunks, or kill FFmpeg |

Events use the name `audio-progress` and the payload `{ step, progress, message, done }`.

The mix filter is `volume`, `atrim`, `afade`, `adelay`, `apad`, and `amix` with `normalize=0`. Looping adds `-stream_loop -1` on the music input. The video map is `-c:v copy`. Output is AAC at 192 kbps with `+faststart`. Progress comes from FFmpeg `-progress pipe:1` (`out_time_us` / `out_time_ms` are both microseconds).

Before render, the panel can play vocals only, the imported song only, or both. Fades are applied at render time. Preview gain is capped at 1 by the audio element; the file uses the slider value up to 1.5.

## Using the editor

- **+** next to the title, the **+** on the timeline, or the **+** in the prompt imports a video. MP4 and WebM are the reliable preview formats.
- Space plays and pauses. Arrow keys nudge the playhead. Home and End jump to the ends.
- Drag the white scrubber handle, the ruler, or the clip row to seek. The selected clip’s dark **‹ ›** handles trim its start and end in the timeline. Trimming does not re-encode.
- The chips set aspect, resolution, a preview grade (Warm, Cool, Mono, Soft), and the selected clip length. The grid button toggles thirds. The hexagon toggles snap-to-clips.
- The music-note tool opens **Audio**.
  1. Upload video (or use the file already on the timeline).
  2. Separate vocals and music.
  3. Import music (Suno export).
  4. Set music volume, vocal volume, start offset, loop, and fades, then mix and render.
- **Open folder** reveals the finished mp4. The job directory also keeps `vocals.wav` and `instrumental.wav`.

## Roadmap

1. Editor shell, local playback, and timeline thumbnails.
2. One-click audio on the desktop: on-device separation, a local song file, and an FFmpeg sidecar that writes the file. This tree.
3. Effects and plugins. Transitions, color, text, and a small plugin surface on the tool rail. The rail buttons for those tools already explain that they are later work. Android FFmpeg belongs with that platform pass.

## Known gaps

- The Dribbble references could not be fetched from this environment, so the layout follows the written shot description rather than the original pixels.
- `src-tauri/gen/android` is not in the tree until `android init` runs on a machine with the SDK. FFmpeg on Android is stubbed, as described above.
- The vocal model is downloaded on first use. It is not bundled.
- Browser-only dev cannot separate or render. `npm run tauri dev` uses the real commands and real paths.
- Cancel takes effect between separation windows and by killing FFmpeg. A single ONNX window runs to completion.
- The content security policy allows blob, data, and `asset:` media for local preview.
- Grades are CSS filters on the preview, not a render pass. Aspect and resolution are project settings, not an export.
- Demo stills in `public/demo/` are original generated placeholders for the empty state.

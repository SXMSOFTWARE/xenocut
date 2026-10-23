# XenoCut

XenoCut is a lightweight video editor for Windows, Linux, and Android. Milestone 1 is the cinematic editor shell: import a video, play and scrub it, and open the one-click audio flow. Media processing will go through FFmpeg from Rust. The shell stays small on purpose: React, TypeScript, Vite, Tailwind, Zustand, and Lucide. No component library.

The empty project opens on **Silent Passage**, a generated still of an eye with crimson feathers and gold makeup, so the editor looks finished before a file is imported.

## Run the UI

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run dev` is the fast path for layout and playback. Outside the Tauri webview, audio steps 2–4 use a small in-browser mock that emits the same progress shape as the Rust `audio-progress` events.

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

```bash
npm install
npm run tauri dev
npm run tauri build
```

`tauri dev` starts Vite on port 43123 and opens the native window. The window is a dark canvas; the editor sits centered on it and goes fullscreen when the window is narrow, which is the Android layout.

Check the Rust crate without launching a window:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Android

The Rust library is already a mobile entry point. `src-tauri/src/lib.rs` uses `#[cfg_attr(mobile, tauri::mobile_entry_point)]`, and the crate types are `staticlib`, `cdylib`, and `rlib`.

This environment has no Android SDK, so the native project is not generated. `npm run tauri android init` stops with:

```text
Android SDK not found. Make sure the SDK and NDK are installed and the ANDROID_HOME and NDK_HOME environment variables are set.
```

On a machine with the SDK:

1. Install [Android Studio](https://developer.android.com/studio). In the SDK Manager, install a current Android SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, and the NDK (Side by side).
2. Point the environment at them:

   ```bash
   export JAVA_HOME=/opt/android-studio/jbr
   export ANDROID_HOME="$HOME/Android/Sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 "$ANDROID_HOME/ndk" | tail -1)"
   ```

   Windows paths and the full list are in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
3. Add the Rust targets:

   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

4. Generate the Android project, then run or build:

   ```bash
   npm run android:init
   npm run android:dev
   npm run android:build
   ```

   Those scripts call `tauri android init`, `tauri android dev`, and `tauri android build`. `android init` writes `src-tauri/gen/android`.

On a phone-width window the editor is fullscreen, the prompt becomes a bottom sheet, the tool rail stays a compact column, and the format chips scroll sideways.

## Architecture

```text
src/
  components/     EditorShell, IconRail, PreviewArea, PromptPanel,
                  Timeline, ClipStrip, TransportBar, QuickSettings,
                  AudioEditingFlow
  store/          Zustand editor state
  lib/            thumbnails, clip math, Tauri/mock audio client
  context/        playback, seek, and the file picker
src-tauri/src/
  lib.rs          Tauri builder and mobile entry point
  audio/
    traits.rs     StemSeparator, MusicProvider, Renderer
    separator.rs  OnnxMdxSeparator stub (planned: ort + MDX-Net/UVR)
    music.rs      third-party Suno or local-file stub
    renderer.rs   FFmpeg argument plan, not executed
    commands.rs   invoke handlers and audio-progress events
```

The preview is a `<video>` element. Transport buttons, the scrubber, and the playhead share one clock. With no file loaded, playback moves the playhead across the demo timeline. Import uses the browser file input (and drag-and-drop). Frames for the clip strips are drawn to a canvas in the page, not in Rust.

Rust commands:

| Command | Step | What the stub does |
| --- | --- | --- |
| `audio_separate_stems` | Separate vocals and music | Emits progress, returns planned wav paths |
| `audio_import_music` | Suno prompt or a local filename | Emits progress, returns a planned music path |
| `audio_mix_render` | Mix and render | Builds an FFmpeg argument list and does not run it |

Events use the name `audio-progress` and the payload `{ step, progress, message, done }`.

### Traits

- **StemSeparator** — on-device vocal separation. The planned engine is an ONNX MDX-Net or UVR model through the `ort` crate, so source audio stays on the machine.
- **MusicProvider** — `MusicRequest::Suno` or `MusicRequest::LocalFile`. Suno has no official public API. The Suno path is reserved for a third-party provider that will use a key the user supplies. The local path imports a file the user already has.
- **Renderer** — mix and encode. The planned implementation is a bundled FFmpeg sidecar. `ffmpeg_args` in `renderer.rs` is the command that sidecar will receive. Milestone 1 does not spawn FFmpeg.

Each planned body is marked `TODO(milestone-2)`.

## Using the editor

- **+** next to the title, the **+** on the timeline, or the **+** in the prompt imports a video. MP4 and WebM are the reliable preview formats.
- Space plays and pauses. Arrow keys nudge the playhead. Home and End jump to the ends.
- Drag the white scrubber handle, the ruler, or the clip row to seek. The selected clip’s dark **‹ ›** handles trim its start and end in the timeline. Trimming does not re-encode.
- The chips set aspect, resolution, a preview grade (Warm, Cool, Mono, Soft), and the selected clip length. The grid button toggles thirds. The hexagon toggles snap-to-clips.
- The music-note tool opens **Audio**. Step 1 picks a real file. Steps 2–4 call the stub commands and show their progress.

## Roadmap

1. **Milestone 1 (this tree).** Editor shell, local playback, timeline thumbnails, and the audio-flow contract.
2. **One-click audio.** Bundle an ONNX separator, a music provider (third-party Suno with the user’s key, or a local file copied into the project), and an FFmpeg sidecar that actually mixes and writes the file on Windows, Linux, and Android.
3. **Effects and plugins.** Transitions, color, text, and a small plugin surface on the tool rail. The rail buttons for those tools already explain that they are later work.

## Known gaps

- The Dribbble references could not be fetched from this environment, so the layout follows the written shot description rather than the original pixels.
- `src-tauri/gen/android` is not in the tree until `android init` runs on a machine with the SDK.
- FFmpeg is not bundled, and the separator does not load a model. Stub commands sleep briefly and emit progress. They do not write media.
- Browser-only dev cannot call Rust. The mock in `src/lib/audioApi.ts` covers that case. `npm run tauri dev` uses the real commands.
- The content security policy allows blob and data media for local preview. It has not been exercised inside a packaged webview.
- Grades are CSS filters on the preview, not a render pass. Aspect and resolution are project settings, not an export.
- Demo stills in `public/demo/` are original generated placeholders for the empty state.

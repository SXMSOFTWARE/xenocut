# Third-party notices

XenoCut is built on the following open-source projects. Each keeps its own license.

| Project | License | Source |
|---|---|---|
| Tauri | MIT / Apache-2.0 | https://github.com/tauri-apps/tauri |
| React | MIT | https://github.com/facebook/react |
| Zustand | MIT | https://github.com/pmndrs/zustand |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| Fontsource | MIT | https://github.com/fontsource/fontsource |
| Inter | OFL-1.1 | https://github.com/rsms/inter |
| Montserrat | OFL-1.1 | https://github.com/JulietaUla/Montserrat |
| Anton | OFL-1.1 | https://fonts.google.com/specimen/Anton |
| Bangers | OFL-1.1 | https://fonts.google.com/specimen/Bangers |
| Bebas Neue | OFL-1.1 | https://fonts.google.com/specimen/Bebas+Neue |
| Caveat | OFL-1.1 | https://fonts.google.com/specimen/Caveat |
| Oswald | OFL-1.1 | https://fonts.google.com/specimen/Oswald |
| Playfair Display | OFL-1.1 | https://fonts.google.com/specimen/Playfair+Display |
| FFmpeg | GPL-2.0+ | https://ffmpeg.org |
| x264 | GPL-2.0+ | https://code.videolan.org/videolan/x264 |
| Candle | MIT / Apache-2.0 | https://github.com/huggingface/candle |
| OpenAI Whisper (model) | MIT | https://github.com/openai/whisper |
| ONNX Runtime / ort | MIT / Apache-2.0 | https://github.com/pykeio/ort |
| Ultimate Vocal Remover (MDX-Net model) | MIT | https://github.com/Anjok07/ultimatevocalremovergui |
| RustFFT | MIT / Apache-2.0 | https://github.com/ejmahler/RustFFT |
| ndarray | MIT / Apache-2.0 | https://github.com/rust-ndarray/ndarray |
| hound | Apache-2.0 | https://github.com/ruuda/hound |
| Serde | MIT / Apache-2.0 | https://github.com/serde-rs/serde |
| reqwest | MIT / Apache-2.0 | https://github.com/seanmonstar/reqwest |
| lottie-web | MIT | https://github.com/airbnb/lottie-web |
| gl-transitions (shaders in the transition packs) | MIT | https://github.com/gl-transitions/gl-transitions |
| OpenFX API headers and HostSupport library | BSD-3-Clause | https://github.com/AcademySoftwareFoundation/openfx |
| Expat (XML parser, used by the OpenFX HostSupport library) | MIT | https://github.com/libexpat/libexpat |

FFmpeg (with x264) is shipped as a separate, unmodified executable that XenoCut runs as a subprocess. Its GPL source is available from https://ffmpeg.org and the build scripts in `scripts/` (desktop builds come from https://github.com/BtbN/FFmpeg-Builds).

The OpenFX headers, the OpenFX HostSupport library and Expat are compiled into the Linux effect host (`src-tauri/fxhost/vendor/`, with their license files). The frei0r ABI is declared in our own code; no frei0r or OpenFX plug-ins ship with XenoCut, and the host only loads plug-ins the user installs. The built-in transitions' GLSL previews are ports of FFmpeg's `xfade` formulas (LGPL-2.1+, libavfilter/vf_xfade.c).

Fonts are licensed under the SIL Open Font License 1.1. AI model weights are downloaded on demand from their original publishers.

## Media

The effect preview animations in `src/assets/fx-demos/` are rendered from two seconds of *Tears of Steel*, (CC) Blender Foundation | mango.blender.org, licensed under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/). The footage was cropped, scaled and run through XenoCut's effects; `scripts/fetch-demo-clip.sh` fetches the source. The two stills in `src/assets/trans-demo/` (transition browser demos) are frames of the same film at 0:40 and 4:50, cropped and scaled.

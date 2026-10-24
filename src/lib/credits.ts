/** Open-source software and assets XenoCut ships with or downloads at runtime. Shown in Settings → About. */
export interface Credit {
  name: string;
  license: string;
  url: string;
  /** i18n key describing what XenoCut uses it for. */
  use: "app" | "ui" | "font" | "media" | "ai" | "audio";
}

export const CREDITS: Credit[] = [
  { name: "Tauri", license: "MIT / Apache-2.0", url: "https://github.com/tauri-apps/tauri", use: "app" },
  { name: "React", license: "MIT", url: "https://github.com/facebook/react", use: "ui" },
  { name: "Zustand", license: "MIT", url: "https://github.com/pmndrs/zustand", use: "ui" },
  { name: "Lucide", license: "ISC", url: "https://github.com/lucide-icons/lucide", use: "ui" },
  { name: "Fontsource", license: "MIT", url: "https://github.com/fontsource/fontsource", use: "font" },
  { name: "Inter", license: "OFL-1.1", url: "https://github.com/rsms/inter", use: "font" },
  { name: "Montserrat", license: "OFL-1.1", url: "https://github.com/JulietaUla/Montserrat", use: "font" },
  { name: "Anton", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Anton", use: "font" },
  { name: "Bangers", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Bangers", use: "font" },
  { name: "Bebas Neue", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Bebas+Neue", use: "font" },
  { name: "Caveat", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Caveat", use: "font" },
  { name: "Oswald", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Oswald", use: "font" },
  { name: "Playfair Display", license: "OFL-1.1", url: "https://fonts.google.com/specimen/Playfair+Display", use: "font" },
  { name: "FFmpeg", license: "GPL-2.0+", url: "https://ffmpeg.org", use: "media" },
  { name: "x264", license: "GPL-2.0+", url: "https://code.videolan.org/videolan/x264", use: "media" },
  { name: "Candle", license: "MIT / Apache-2.0", url: "https://github.com/huggingface/candle", use: "ai" },
  { name: "OpenAI Whisper (model)", license: "MIT", url: "https://github.com/openai/whisper", use: "ai" },
  { name: "ONNX Runtime / ort", license: "MIT / Apache-2.0", url: "https://github.com/pykeio/ort", use: "ai" },
  { name: "Ultimate Vocal Remover (MDX-Net model)", license: "MIT", url: "https://github.com/Anjok07/ultimatevocalremovergui", use: "ai" },
  { name: "RustFFT", license: "MIT / Apache-2.0", url: "https://github.com/ejmahler/RustFFT", use: "audio" },
  { name: "ndarray", license: "MIT / Apache-2.0", url: "https://github.com/rust-ndarray/ndarray", use: "audio" },
  { name: "hound", license: "Apache-2.0", url: "https://github.com/ruuda/hound", use: "audio" },
  { name: "Serde", license: "MIT / Apache-2.0", url: "https://github.com/serde-rs/serde", use: "app" },
  { name: "reqwest", license: "MIT / Apache-2.0", url: "https://github.com/seanmonstar/reqwest", use: "app" },
];

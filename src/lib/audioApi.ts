import type { AudioProgress } from "../types";

export interface SeparateResult {
  vocalsPath: string;
  instrumentalPath: string;
  message: string;
}

export interface MusicResult {
  musicPath: string;
  message: string;
}

export interface RenderResult {
  outputPath: string;
  message: string;
}

export interface RenderArgs {
  videoPath: string;
  vocalsPath: string;
  musicPath: string;
  vocalGain: number;
  musicGain: number;
  musicOffset: number;
  loopMusic: boolean;
  fadeIn: number;
  fadeOut: number;
  videoDuration: number;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function fileUrl(path: string): Promise<string> {
  if (!isTauri()) return path;
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

export async function pickPath(kind: "video" | "music"): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters:
      kind === "video"
        ? [{ name: "Video", extensions: ["mp4", "webm", "mov", "mkv", "m4v"] }]
        : [{ name: "Suno export", extensions: ["mp3", "wav", "m4a"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function revealOutput(path: string): Promise<void> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function cancelAudio(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("audio_cancel");
}

export async function separateStems(
  inputPath: string,
  onProgress: (event: AudioProgress) => void,
): Promise<SeparateResult> {
  return invokeStep(2, "audio_separate_stems", { inputPath }, onProgress);
}

export async function importMusic(
  localPath: string,
  onProgress: (event: AudioProgress) => void,
): Promise<MusicResult> {
  return invokeStep(3, "audio_import_music", { localPath }, onProgress);
}

export async function mixRender(
  request: RenderArgs,
  onProgress: (event: AudioProgress) => void,
): Promise<RenderResult> {
  return invokeStep(4, "audio_mix_render", { request }, onProgress);
}

async function invokeStep<T>(
  step: number,
  command: string,
  args: Record<string, unknown>,
  onProgress: (event: AudioProgress) => void,
): Promise<T> {
  if (!isTauri()) {
    throw new Error("This step runs in the desktop app, where FFmpeg can read the file.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<AudioProgress>("audio-progress", (event) => {
    if (event.payload.step === step) onProgress(event.payload);
  });
  try {
    return await invoke<T>(command, args);
  } finally {
    unlisten();
  }
}

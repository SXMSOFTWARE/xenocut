import type { AudioProgress } from "../types";

export interface AudioStepArgs {
  inputPath?: string;
  prompt?: string;
  localPath?: string | null;
  vocalGain?: number;
  musicGain?: number;
}

const MOCK_STEPS: Record<2 | 3 | 4, { progress: number; message: string }[]> = {
  2: [
    { progress: 0.08, message: "Opening source" },
    { progress: 0.24, message: "Loading ONNX session (stub)" },
    { progress: 0.52, message: "Separating vocals" },
    { progress: 0.78, message: "Writing instrumental stem" },
    { progress: 1, message: "Stems ready (stub, files not written)" },
  ],
  3: [
    { progress: 0.16, message: "Contacting music provider (stub)" },
    { progress: 0.48, message: "Fetching arrangement" },
    { progress: 0.8, message: "Downloading preview" },
    { progress: 1, message: "Music imported (stub, file not written)" },
  ],
  4: [
    { progress: 0.1, message: "Preparing FFmpeg graph (stub, not executed)" },
    { progress: 0.38, message: "Mixing dialogue and music" },
    { progress: 0.7, message: "Encoding video" },
    { progress: 0.9, message: "Writing output" },
    { progress: 1, message: "Render complete (stub, file not written)" },
  ],
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function mockStep(
  step: 2 | 3 | 4,
  onProgress: (event: AudioProgress) => void,
): Promise<string> {
  const steps = MOCK_STEPS[step];
  let message = "";
  for (let index = 0; index < steps.length; index += 1) {
    if (index > 0) await sleep(170);
    const current = steps[index];
    message = current.message;
    onProgress({
      step,
      progress: current.progress,
      message,
      done: current.progress >= 1,
    });
  }
  return message;
}

export async function runAudioStep(
  step: 2 | 3 | 4,
  args: AudioStepArgs,
  onProgress: (event: AudioProgress) => void,
): Promise<string> {
  if (!isTauri()) {
    // Outside the Tauri webview there is no Rust process. The mock emits the
    // same progress shape as the `audio-progress` events from the stub commands.
    return mockStep(step, onProgress);
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<AudioProgress>("audio-progress", (event) => {
    if (event.payload.step === step) onProgress(event.payload);
  });

  try {
    if (step === 2) {
      return await invoke<string>("audio_separate_stems", {
        inputPath: args.inputPath ?? "",
      });
    }
    if (step === 3) {
      return await invoke<string>("audio_import_music", {
        prompt: args.prompt ?? "",
        localPath: args.localPath ?? null,
      });
    }
    return await invoke<string>("audio_mix_render", {
      videoPath: args.inputPath ?? "",
      vocalGain: args.vocalGain ?? 1,
      musicGain: args.musicGain ?? 0.8,
    });
  } finally {
    unlisten();
  }
}

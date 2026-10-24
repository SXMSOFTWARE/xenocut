// The running subtitle job lives outside the panel so closing the panel never loses it.
import { create } from "zustand";
import { api, listen, type SubtitleCue, type TranscribeOptions } from "../lib/backend";
import { messageOf } from "../lib/format";
import type { Project } from "../project/types";

export type SubtitleStage = "download" | "mix" | "load" | "recognize";

interface SubtitleJob {
  running: boolean;
  progress: number;
  stage: SubtitleStage;
  error: string | null;
  cancelled: boolean;
  /** Cue count and detected language of the last finished run. */
  last: { cues: number; language: string } | null;
  run: (project: Project, options: TranscribeOptions, apply: (cues: SubtitleCue[], language: string) => void) => Promise<void>;
  cancel: () => void;
}

export const useSubtitleJob = create<SubtitleJob>((set, get) => ({
  running: false,
  progress: 0,
  stage: "mix",
  error: null,
  cancelled: false,
  last: null,
  run: async (project, options, apply) => {
    if (get().running) return;
    set({ running: true, progress: 0, stage: "mix", error: null, cancelled: false });
    const unlisten = await listen<{ progress: number; message: string }>("subtitle-progress", (p) =>
      set({ progress: p.progress, stage: (p.message as SubtitleStage) || "recognize" }),
    );
    try {
      const out = await api.subtitleTranscribe(project, options);
      apply(out.cues, out.language);
      set({ last: { cues: out.cues.length, language: out.language } });
    } catch (error) {
      const message = messageOf(error);
      if (get().cancelled || /cancel/i.test(message)) set({ cancelled: true });
      else set({ error: message });
    } finally {
      unlisten();
      set({ running: false });
    }
  },
  cancel: () => {
    set({ cancelled: true });
    void api.subtitleCancel();
  },
}));

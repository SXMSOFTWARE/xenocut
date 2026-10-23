import { create } from "zustand";
import { DEMO_DURATION, DEMO_PROMPT, demoClips } from "../data/demo";
import { clipsFromMedia, trimClipEdge } from "../lib/clips";
import type { Aspect, AudioStepState, Clip, Grade, Resolution, ToolId } from "../types";

function idleStep(): AudioStepState {
  return { status: "idle", progress: 0, message: "" };
}

function freshAudio(): { 2: AudioStepState; 3: AudioStepState; 4: AudioStepState } {
  return { 2: idleStep(), 3: idleStep(), 4: idleStep() };
}

interface EditorState {
  projectName: string;
  prompt: string;
  promptOpen: boolean;
  tool: ToolId;
  videoUrl: string | null;
  videoName: string | null;
  duration: number;
  currentTime: number;
  playing: boolean;
  importing: boolean;
  clips: Clip[];
  selectedClipId: string | null;
  aspect: Aspect;
  resolution: Resolution;
  grade: Grade;
  guides: boolean;
  snap: boolean;
  toast: string | null;
  toastToken: number;
  musicPrompt: string;
  musicName: string | null;
  vocalGain: number;
  musicGain: number;
  audio: { 2: AudioStepState; 3: AudioStepState; 4: AudioStepState };
  setProjectName: (name: string) => void;
  setPrompt: (prompt: string) => void;
  setPromptOpen: (open: boolean) => void;
  setTool: (tool: ToolId) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  selectClip: (id: string) => void;
  trimClip: (id: string, edge: "start" | "end", time: number) => void;
  setAspect: (aspect: Aspect) => void;
  setResolution: (resolution: Resolution) => void;
  setGrade: (grade: Grade) => void;
  toggleGuides: () => void;
  setSnap: (snap: boolean) => void;
  showToast: (toast: string) => void;
  setMusicPrompt: (prompt: string) => void;
  setMusicName: (name: string | null) => void;
  setVocalGain: (gain: number) => void;
  setMusicGain: (gain: number) => void;
  beginVideoImport: (url: string, name: string) => void;
  completeVideoImport: (duration: number, frames: string[]) => void;
  failVideoImport: () => void;
  setAudioStep: (step: 2 | 3 | 4, patch: Partial<AudioStepState>) => void;
  resetAudioFrom: (step: 2 | 3 | 4) => void;
}

const demoSelection = "clip-red";

export const useEditorStore = create<EditorState>((set, get) => ({
  projectName: "Silent Passage",
  prompt: DEMO_PROMPT,
  promptOpen: true,
  tool: "video",
  videoUrl: null,
  videoName: null,
  duration: DEMO_DURATION,
  currentTime: 48,
  playing: false,
  importing: false,
  clips: demoClips(),
  selectedClipId: demoSelection,
  aspect: "9:16",
  resolution: "1440p",
  grade: "None",
  guides: false,
  snap: false,
  toast: null,
  toastToken: 0,
  musicPrompt: "Warm cinematic pulse, sparse piano, no vocals",
  musicName: null,
  vocalGain: 1,
  musicGain: 0.8,
  audio: freshAudio(),
  setProjectName: (projectName) => set({ projectName }),
  setPrompt: (prompt) => set({ prompt }),
  setPromptOpen: (promptOpen) => set({ promptOpen }),
  setTool: (tool) => set({ tool, promptOpen: true }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaying: (playing) => set({ playing }),
  selectClip: (selectedClipId) => set({ selectedClipId }),
  trimClip: (id, edge, time) =>
    set((state) => ({
      clips: trimClipEdge(state.clips, id, edge, time, state.duration),
    })),
  setAspect: (aspect) => set({ aspect }),
  setResolution: (resolution) => set({ resolution }),
  setGrade: (grade) => set({ grade }),
  toggleGuides: () => set((state) => ({ guides: !state.guides })),
  setSnap: (snap) => set({ snap }),
  showToast: (toast) => {
    const toastToken = get().toastToken + 1;
    set({ toast, toastToken });
    window.setTimeout(() => {
      if (get().toastToken === toastToken) set({ toast: null });
    }, 2400);
  },
  setMusicPrompt: (musicPrompt) => set({ musicPrompt }),
  setMusicName: (musicName) => set({ musicName }),
  setVocalGain: (vocalGain) => set({ vocalGain }),
  setMusicGain: (musicGain) => set({ musicGain }),
  beginVideoImport: (url, videoName) => {
    const previous = get().videoUrl;
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    set({
      videoUrl: url,
      videoName,
      playing: false,
      currentTime: 0,
      importing: true,
      audio: freshAudio(),
      musicName: null,
    });
  },
  completeVideoImport: (duration, frames) => {
    const clips = clipsFromMedia(duration, frames);
    const playing = get().playing;
    set({
      duration,
      clips,
      selectedClipId: clips[clips.length - 1]?.id ?? null,
      currentTime: playing ? Math.min(get().currentTime, duration) : 0,
      importing: false,
    });
  },
  failVideoImport: () => {
    const previous = get().videoUrl;
    if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
    set({
      videoUrl: null,
      videoName: null,
      duration: DEMO_DURATION,
      currentTime: 48,
      playing: false,
      importing: false,
      clips: demoClips(),
      selectedClipId: demoSelection,
    });
  },
  setAudioStep: (step, patch) =>
    set((state) => ({
      audio: {
        ...state.audio,
        [step]: { ...state.audio[step], ...patch },
      },
    })),
  resetAudioFrom: (step) =>
    set((state) => ({
      audio: {
        2: step <= 2 ? idleStep() : state.audio[2],
        3: step <= 3 ? idleStep() : state.audio[3],
        4: idleStep(),
      },
    })),
}));

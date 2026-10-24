import { create } from "zustand";

export const MIN_PPS = 4;
export const MAX_PPS = 400;

export type PanelId = "media" | "voice" | "music" | "effects" | "audio" | "color" | "text" | "captions" | "lyrics";

interface EditorUiState {
  /** Floating context panel driven by the left rail; null = closed. */
  panel: PanelId | null;
  timelineCollapsed: boolean;
  pxPerSec: number;
  snapping: boolean;
  snapLine: number | null;
  exportOpen: boolean;
  dragMedia: { mediaId: string; x: number; y: number } | null;
  dropHint: { trackId: string | null; start: number; duration: number } | null;
  setZoom: (pps: number) => void;
}

export const useEditorUi = create<EditorUiState>((set) => ({
  panel: "media",
  timelineCollapsed: false,
  pxPerSec: 40,
  snapping: true,
  snapLine: null,
  exportOpen: false,
  dragMedia: null,
  dropHint: null,
  setZoom: (pps) => set({ pxPerSec: Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) }),
}));

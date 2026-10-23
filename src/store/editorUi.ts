import { create } from "zustand";

export const MIN_PPS = 4;
export const MAX_PPS = 400;

interface EditorUiState {
  pxPerSec: number;
  snapping: boolean;
  snapLine: number | null;
  exportOpen: boolean;
  dragMedia: { mediaId: string; x: number; y: number } | null;
  dropHint: { trackId: string | null; start: number; duration: number } | null;
  setZoom: (pps: number) => void;
}

export const useEditorUi = create<EditorUiState>((set) => ({
  pxPerSec: 40,
  snapping: true,
  snapLine: null,
  exportOpen: false,
  dragMedia: null,
  dropHint: null,
  setZoom: (pps) => set({ pxPerSec: Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) }),
}));

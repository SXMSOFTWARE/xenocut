import { create } from "zustand";

/** Kept apart from the project store: `time` changes every frame while playing. */
interface PlaybackState {
  time: number;
  playing: boolean;
  /** Last media load/decode failure, shown over the preview. */
  mediaError: string | null;
}

export const usePlayback = create<PlaybackState>(() => ({ time: 0, playing: false, mediaError: null }));

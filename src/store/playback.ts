import { create } from "zustand";

/** Kept apart from the project store: `time` changes every frame while playing. */
interface PlaybackState {
  time: number;
  playing: boolean;
}

export const usePlayback = create<PlaybackState>(() => ({ time: 0, playing: false }));

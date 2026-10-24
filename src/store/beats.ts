import { create } from "zustand";
import { api } from "../lib/backend";
import { songClip, timelineBeats, type BeatGrid } from "../project/beats";
import type { Project } from "../project/types";

// Detected beats per media path (source seconds), so moving or trimming the song keeps them in place.
interface BeatsState {
  grids: Record<string, BeatGrid>;
  busy: string | null;
  /** Draw beat markers on the ruler and snap clip edges to them. */
  show: boolean;
  detect: (path: string) => Promise<BeatGrid>;
}

export const useBeats = create<BeatsState>((set, get) => ({
  grids: {},
  busy: null,
  show: true,
  detect: async (path) => {
    const cached = get().grids[path];
    if (cached) return cached;
    set({ busy: path });
    try {
      const grid = await api.beatDetect(path);
      set((s) => ({ grids: { ...s.grids, [path]: grid } }));
      return grid;
    } finally {
      set({ busy: null });
    }
  },
}));

/** The song clip, its media path and grid (when detected). */
export function songBeats(p: Project | null, grids: Record<string, BeatGrid>) {
  if (!p) return null;
  const clip = songClip(p);
  const path = clip && p.media.find((m) => m.id === clip.mediaId)?.path;
  if (!clip || !path) return null;
  const grid = grids[path] ?? null;
  return { clip, path, grid };
}

/** Timeline beat times for markers and snapping; empty when hidden or not detected. */
export function visibleBeats(p: Project | null, ignore: ReadonlySet<string> = new Set()): number[] {
  const s = useBeats.getState();
  if (!s.show) return [];
  const song = songBeats(p, s.grids);
  // Beats ride on the song clip, so they are no snap target while that clip itself moves.
  return song?.grid && !ignore.has(song.clip.id) ? timelineBeats(song.clip, song.grid) : [];
}

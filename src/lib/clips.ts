import { DEMO_FRAMES } from "../data/demo";
import type { Clip, Tint } from "../types";
import { clamp } from "./time";

const WEIGHTS = [12, 10, 18, 18];
const COUNTS = [3, 2, 3, 3];
/** Reference palette, repeated when an import produces more strips than colors. */
const TINTS: Tint[] = ["blue", "gold", "purple", "red"];

export function clipsFromMedia(duration: number, frames: string[]): Clip[] {
  const pool = frames.length > 0 ? frames : DEMO_FRAMES;
  const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  return WEIGHTS.map((weight, index) => {
    const start = cursor;
    const end = index === WEIGHTS.length - 1 ? duration : cursor + (duration * weight) / total;
    cursor = end;
    const thumbnails = Array.from(
      { length: COUNTS[index] },
      (_, offset) => pool[(index + offset) % pool.length],
    );
    return {
      id: `clip-${TINTS[index]}-${index}`,
      start,
      end,
      tint: TINTS[index % TINTS.length],
      thumbnails,
    };
  });
}

export function trimClipEdge(
  clips: Clip[],
  id: string,
  edge: "start" | "end",
  time: number,
  duration: number,
): Clip[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return clips;

  const clip = clips[index];
  const prevEnd = index > 0 ? clips[index - 1].end : 0;
  const nextStart = index < clips.length - 1 ? clips[index + 1].start : duration;
  const minLen = Math.min(0.35, Math.max(0.05, duration / 20));

  if (edge === "start") {
    const start = clamp(time, prevEnd, clip.end - minLen);
    return clips.map((item) => (item.id === id ? { ...item, start } : item));
  }

  const end = clamp(time, clip.start + minLen, nextStart);
  return clips.map((item) => (item.id === id ? { ...item, end } : item));
}

export function snapTime(time: number, clips: Clip[], threshold: number): number {
  let best = time;
  let bestDistance = threshold;
  for (const clip of clips) {
    for (const point of [clip.start, clip.end]) {
      const distance = Math.abs(point - time);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
  }
  return best;
}

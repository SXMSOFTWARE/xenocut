// Beat-synced editing (the AMV tools): beats detected on the song (see src-tauri/src/beats.rs),
// mapped onto the timeline, then used to cut, re-cut into a montage, or punctuate clips with hits.
import { HIT_KINDS, type ClipEffect, type EffectKind } from "./effects";
import { clipDuration, clipEnd, MIN_CLIP_SECONDS, splitClip } from "./ops";
import type { Clip, Project, Track } from "./types";
import { uid } from "../lib/id";

/** What `beat_detect` returns, in seconds of the analysed source file. */
export interface BeatGrid {
  bpm: number;
  beats: number[];
  strength: number[];
  /** Index (0..3) of the first downbeat. */
  downbeat: number;
  duration: number;
}

export interface Hits {
  flash: number;
  punch: number;
  hitShake: number;
}

const EPS = 1e-3;

/** The clip the beat follows: the first clip on a music / audio track, else the first video with sound. */
export function songClip(p: Project): Clip | undefined {
  const kinds = new Map(p.tracks.map((t) => [t.id, t.kind]));
  const media = new Map(p.media.map((m) => [m.id, m]));
  const byStart = [...p.clips].filter((c) => !c.text && media.get(c.mediaId)?.hasAudio).sort((a, b) => a.start - b.start);
  return (
    byStart.find((c) => kinds.get(c.trackId) === "music") ??
    byStart.find((c) => kinds.get(c.trackId) === "audio") ??
    byStart.find((c) => kinds.get(c.trackId) === "video")
  );
}

/** Beats of the song clip in timeline seconds (only the part of the source the clip plays). */
export function timelineBeats(clip: Clip, grid: BeatGrid): number[] {
  const speed = clip.speed || 1;
  return grid.beats.filter((b) => b >= clip.in - EPS && b <= clip.out + EPS).map((b) => clip.start + (b - clip.in) / speed);
}

/** Index in `grid.beats` of the first beat inside the clip, to keep bar counting aligned. */
function firstIndex(clip: Clip, grid: BeatGrid): number {
  const i = grid.beats.findIndex((b) => b >= clip.in - EPS);
  return i < 0 ? 0 : i;
}

/** Every `every`-th beat, counted from the downbeat so 4 lands on bars. */
export function pickBeats(times: number[], every: number, downbeat: number, offset = 0): number[] {
  const n = Math.max(1, Math.round(every));
  const phase = (((downbeat - offset) % n) + n) % n;
  return times.filter((_, i) => (((i - phase) % n) + n) % n === 0);
}

/** Cut points on the timeline: every `every` beats of the song clip. */
export function beatCuts(p: Project, grid: BeatGrid, every: number): number[] {
  const clip = songClip(p);
  if (!clip) return [];
  return pickBeats(timelineBeats(clip, grid), every, grid.downbeat, firstIndex(clip, grid));
}

/** The track the edit lives on: the topmost video track holding real (non-text) clips. */
export function mainVideoTrack(p: Project): Track | undefined {
  const video = p.tracks.filter((t) => t.kind === "video");
  return video.find((t) => p.clips.some((c) => c.trackId === t.id && !c.text)) ?? video[0];
}

/** Split every main-track clip at the cut points. */
export function cutOnBeats(p: Project, cuts: number[]): { project: Project; count: number } {
  const track = mainVideoTrack(p);
  if (!track) return { project: p, count: 0 };
  let project = p;
  let count = 0;
  for (const at of cuts) {
    const clip = project.clips.find((c) => c.trackId === track.id && at > c.start + EPS && at < clipEnd(c) - EPS);
    if (!clip) continue;
    const res = splitClip(project, clip.id, at);
    if (res.rightId) {
      project = res.project;
      count++;
    }
  }
  return { project, count };
}

/**
 * Re-cut the main track into a montage: one segment per cut interval over the song, cycling through
 * the track's clips and moving forward through each source so shots don't repeat until they run out.
 */
export function beatMontage(p: Project, cuts: number[], range: { start: number; end: number }, muteSource: boolean): { project: Project; count: number } {
  const track = mainVideoTrack(p);
  if (!track) return { project: p, count: 0 };
  const media = new Map(p.media.map((m) => [m.id, m]));
  const sources = p.clips.filter((c) => c.trackId === track.id && !c.text && media.has(c.mediaId)).sort((a, b) => a.start - b.start);
  if (!sources.length) return { project: p, count: 0 };
  const bounds = [range.start, ...cuts.filter((c) => c > range.start + MIN_CLIP_SECONDS && c < range.end - MIN_CLIP_SECONDS), range.end];
  const cursor = sources.map((s) => s.in);
  const out: Clip[] = [];
  let k = 0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const length = bounds[i + 1] - bounds[i];
    if (length < MIN_CLIP_SECONDS) continue;
    // The next source with room for the segment (sources too short are skipped; stills always fit).
    let pick = -1;
    for (let tries = 0; tries < sources.length * 2 && pick < 0; tries++) {
      const j = (k + tries) % sources.length;
      const s = sources[j];
      const elastic = media.get(s.mediaId)?.kind === "image";
      const need = length * (s.speed || 1);
      if (elastic) pick = j;
      else if (cursor[j] + need <= s.out + EPS) pick = j;
      else if (tries >= sources.length && s.out - s.in + EPS >= need) {
        cursor[j] = s.in; // every source used up: start over from its in point
        pick = j;
      }
    }
    if (pick < 0) continue;
    const s = sources[pick];
    const elastic = media.get(s.mediaId)?.kind === "image";
    const speed = s.speed || 1;
    const from = elastic ? 0 : cursor[pick];
    const to = from + length * speed;
    if (!elastic) cursor[pick] = to;
    out.push({ ...s, id: uid("c"), start: bounds[i], in: from, out: to, fadeIn: 0, fadeOut: 0, volume: muteSource ? 0 : s.volume });
    k = pick + 1;
  }
  if (!out.length) return { project: p, count: 0 };
  const keep = p.clips.filter((c) => c.trackId !== track.id || c.text);
  return { project: { ...p, clips: [...keep, ...out] }, count: out.length };
}

const withHits = (effects: ClipEffect[] | undefined, hits: Hits | null): ClipEffect[] | undefined => {
  const rest = (effects ?? []).filter((e) => !HIT_KINDS.includes(e.kind));
  const add: ClipEffect[] = hits
    ? (["flash", "punch", "hitShake"] as EffectKind[]).filter((k) => hits[k as keyof Hits] > 0).map((k) => ({ kind: k, amount: hits[k as keyof Hits] }))
    : [];
  const next = [...rest, ...add];
  return next.length ? next : undefined;
};

/** Hit effects on every main-track clip that starts on a cut point (within a frame). */
export function addHits(p: Project, cuts: number[], hits: Hits): { project: Project; count: number } {
  const track = mainVideoTrack(p);
  if (!track) return { project: p, count: 0 };
  const tol = 1 / Math.max(1, p.settings.fps);
  let count = 0;
  const clips = p.clips.map((c) => {
    if (c.trackId !== track.id || c.text || clipDuration(c) < MIN_CLIP_SECONDS) return c;
    if (!cuts.some((t) => Math.abs(t - c.start) <= tol)) return c;
    count++;
    return { ...c, effects: withHits(c.effects, hits) };
  });
  return { project: { ...p, clips }, count };
}

export function clearHits(p: Project): Project {
  return { ...p, clips: p.clips.map((c) => (c.effects?.some((e) => HIT_KINDS.includes(e.kind)) ? { ...c, effects: withHits(c.effects, null) } : c)) };
}

// Pure project operations. Every function returns a new project; nothing mutates.
import { uid } from "../lib/id";
import type { ClipEffect } from "./effects";
import type { Aspect, Clip, MediaItem, ProbeInfo, Project, ProjectSettings, Resolution, Track, TrackKind } from "./types";
import { TEXT_DEFAULT_SECONDS, type TextContent } from "./text";

export const IMAGE_DEFAULT_SECONDS = 5;
export const MIN_CLIP_SECONDS = 0.1;

const SHORT_SIDE: Record<Resolution, number> = { "720p": 720, "1080p": 1080, "1440p": 1440, "4K": 2160 };
const RATIO: Record<Aspect, [number, number]> = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5] };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function dimensions(aspect: Aspect, resolution: Resolution): { width: number; height: number } {
  const [rw, rh] = RATIO[aspect];
  const short = SHORT_SIDE[resolution];
  if (rw >= rh) return { width: even((short * rw) / rh), height: short };
  return { width: short, height: even((short * rh) / rw) };
}

export function settingsFor(aspect: Aspect, resolution: Resolution, fps: number): ProjectSettings {
  return { aspect, resolution, fps, ...dimensions(aspect, resolution) };
}

export function makeTrack(kind: TrackKind, existing: Track[]): Track {
  const base = kind === "video" ? "Video" : kind === "audio" ? "Audio" : kind === "text" ? "Text" : kind === "effect" ? "FX" : "Music";
  const n = existing.filter((t) => t.kind === kind).length + 1;
  return { id: uid("t"), kind, name: `${base} ${n}`, muted: false, hidden: false };
}

export function createProject(name: string, aspect: Aspect, resolution: Resolution, fps: number): Project {
  const now = new Date().toISOString();
  const tracks: Track[] = [];
  tracks.push(makeTrack("video", tracks));
  tracks.push(makeTrack("audio", tracks));
  tracks.push(makeTrack("music", tracks));
  return {
    version: 1,
    id: uid("p"),
    name: name.trim() || "Untitled",
    created: now,
    modified: now,
    settings: settingsFor(aspect, resolution, fps),
    media: [],
    tracks,
    clips: [],
  };
}

export function mediaFromProbe(info: ProbeInfo): MediaItem {
  return {
    id: uid("m"),
    path: info.path,
    name: info.name,
    kind: info.kind,
    duration: info.duration,
    width: info.width,
    height: info.height,
    fps: info.fps,
    hasAudio: info.hasAudio,
    hasVideo: info.hasVideo,
  };
}

export const clipDuration = (clip: Clip) => Math.max(0, clip.out - clip.in) / Math.max(0.01, clip.speed);
export const clipEnd = (clip: Clip) => clip.start + clipDuration(clip);

export function projectDuration(project: Project): number {
  let end = 0;
  for (const clip of project.clips) end = Math.max(end, clipEnd(clip));
  return end;
}

export function maxSourceOut(media: MediaItem | null | undefined): number {
  return !media || media.kind === "image" ? 3600 : media.duration;
}

/** Text clips and stills can be stretched freely; their "in" point is always 0. */
export function isElastic(clip: Clip, media: MediaItem | null | undefined): boolean {
  return !!clip.text || isEffectLayer(clip) || media?.kind === "image";
}

/** A clip on an effect track: no media, no text, only effects. */
export function isEffectLayer(clip: Clip): boolean {
  return !clip.text && clip.mediaId === "";
}

export function trackAccepts(kind: TrackKind, media: MediaItem): boolean {
  if (kind === "text" || kind === "effect") return false;
  if (kind === "video") return media.kind === "video" || media.kind === "image";
  return media.kind === "audio" || (media.kind === "video" && media.hasAudio);
}

export function preferredTrackKind(media: MediaItem): TrackKind {
  if (media.kind === "audio") return media.duration > 60 ? "music" : "audio";
  return "video";
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 - 1e-6 && b0 < a1 - 1e-6;
}

export function isFree(project: Project, trackId: string, start: number, duration: number, ignore: ReadonlySet<string> = new Set()) {
  if (start < -1e-6) return false;
  return !project.clips.some(
    (c) => c.trackId === trackId && !ignore.has(c.id) && overlaps(start, start + duration, c.start, clipEnd(c)),
  );
}

/** The free start nearest to `desired` on a track (never before 0). */
export function nearestFreeStart(
  project: Project,
  trackId: string,
  desired: number,
  duration: number,
  ignore: ReadonlySet<string> = new Set(),
): number {
  const start = Math.max(0, desired);
  if (isFree(project, trackId, start, duration, ignore)) return start;
  const others = project.clips.filter((c) => c.trackId === trackId && !ignore.has(c.id));
  const candidates = [0];
  for (const c of others) {
    candidates.push(clipEnd(c));
    candidates.push(c.start - duration);
  }
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate < 0) continue;
    if (!isFree(project, trackId, candidate, duration, ignore)) continue;
    if (Math.abs(candidate - start) < Math.abs(best - start)) best = candidate;
  }
  return Number.isFinite(best) ? best : others.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
}

export function newClip(media: MediaItem, trackId: string, start: number): Clip {
  const out = media.kind === "image" ? IMAGE_DEFAULT_SECONDS : media.duration;
  return {
    id: uid("c"),
    trackId,
    mediaId: media.id,
    start,
    in: 0,
    out,
    speed: 1,
    volume: 1,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0,
  };
}

export function splitClip(project: Project, clipId: string, at: number): { project: Project; rightId: string | null } {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) return { project, rightId: null };
  const offset = at - clip.start;
  if (offset < MIN_CLIP_SECONDS || clipEnd(clip) - at < MIN_CLIP_SECONDS) return { project, rightId: null };
  const cut = clip.in + offset * clip.speed;
  // The In animation stays on the left part, the Out animation goes to the right one.
  const keep = (anim: Clip["anim"], drop: "in" | "out") => {
    if (!anim) return undefined;
    const rest: NonNullable<Clip["anim"]> = { ...anim };
    delete rest[drop];
    return rest.in || rest.out || rest.combo ? rest : undefined;
  };
  const left: Clip = { ...clip, out: cut, fadeOut: 0, anim: keep(clip.anim, "out") };
  const right: Clip = { ...clip, id: uid("c"), start: at, in: cut, fadeIn: 0, anim: keep(clip.anim, "in") };
  if (!left.anim) delete left.anim;
  if (!right.anim) delete right.anim;
  const clips = project.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c]));
  return { project: { ...project, clips }, rightId: right.id };
}

export function clipsAt(project: Project, time: number): Clip[] {
  return project.clips.filter((c) => time > c.start + 1e-6 && time < clipEnd(c) - 1e-6);
}

/** Snap `time` to the closest candidate within `threshold` seconds. */
export function snap(time: number, candidates: number[], threshold: number): { time: number; snapped: number | null } {
  let best: number | null = null;
  let distance = threshold;
  for (const candidate of candidates) {
    const d = Math.abs(candidate - time);
    if (d <= distance) {
      distance = d;
      best = candidate;
    }
  }
  return best === null ? { time, snapped: null } : { time: best, snapped: best };
}

export function snapCandidates(project: Project, playhead: number, ignore: ReadonlySet<string>, extra: number[] = []): number[] {
  const points = [0, playhead, ...extra];
  for (const c of project.clips) {
    if (ignore.has(c.id)) continue;
    points.push(c.start, clipEnd(c));
  }
  return points;
}

export function removeMediaAndClips(project: Project, mediaId: string): Project {
  return {
    ...project,
    media: project.media.filter((m) => m.id !== mediaId),
    clips: project.clips.filter((c) => c.mediaId !== mediaId),
  };
}

export function updateClip(project: Project, clipId: string, patch: Partial<Clip>): Project {
  return { ...project, clips: project.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) };
}

const TRACK_ORDER: TrackKind[] = ["text", "effect", "video", "audio", "music"];

/** Text tracks on top, then effect layers, video, audio and music; order inside a group is preserved. */
export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => TRACK_ORDER.indexOf(a.kind) - TRACK_ORDER.indexOf(b.kind));
}

export function newTextClip(trackId: string, start: number, text: TextContent, duration = TEXT_DEFAULT_SECONDS): Clip {
  return {
    id: uid("c"),
    trackId,
    mediaId: "",
    start,
    in: 0,
    out: duration,
    speed: 1,
    volume: 1,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0,
    text,
  };
}

/** The first text track, created when missing. Returns the project and the track id. */
export function ensureTextTrack(project: Project, name?: string): { project: Project; trackId: string } {
  const found = project.tracks.find((t) => t.kind === "text" && !t.role && (!name || t.name === name));
  if (found) return { project, trackId: found.id };
  const track = makeTrack("text", project.tracks);
  if (name) track.name = name;
  return { project: { ...project, tracks: sortTracks([...project.tracks, track]) }, trackId: track.id };
}

/** Put a text clip on a text track at (or near) `at`; a new track is added when every one is busy. */
export function addTextClip(project: Project, text: TextContent, at: number, duration = TEXT_DEFAULT_SECONDS): { project: Project; clipId: string } {
  let next = project;
  let trackId = next.tracks.find((t) => t.kind === "text" && !t.role && isFree(next, t.id, at, duration))?.id;
  if (!trackId) {
    const track = makeTrack("text", next.tracks);
    next = { ...next, tracks: sortTracks([...next.tracks, track]) };
    trackId = track.id;
  }
  const clip = newTextClip(trackId, Math.max(0, at), text, duration);
  return { project: { ...next, clips: [...next.clips, clip] }, clipId: clip.id };
}

export function updateText(project: Project, clipId: string, update: (text: TextContent) => TextContent): Project {
  return {
    ...project,
    clips: project.clips.map((c) => (c.id === clipId && c.text ? { ...c, text: update(c.text) } : c)),
  };
}

export const EFFECT_LAYER_SECONDS = 3;

/** Put an effect layer at (or near) `at` on a free effect track; a new track is added when every one is busy. */
export function addEffectLayer(project: Project, effects: ClipEffect[], at: number, duration = EFFECT_LAYER_SECONDS): { project: Project; clipId: string } {
  let next = project;
  const start = Math.max(0, at);
  let trackId = next.tracks.find((t) => t.kind === "effect" && isFree(next, t.id, start, duration))?.id;
  if (!trackId) {
    const track = makeTrack("effect", next.tracks);
    next = { ...next, tracks: sortTracks([...next.tracks, track]) };
    trackId = track.id;
  }
  const clip: Clip = { id: uid("c"), trackId, mediaId: "", start, in: 0, out: duration, speed: 1, volume: 1, opacity: 1, fadeIn: 0, fadeOut: 0, effects };
  return { project: { ...next, clips: [...next.clips, clip] }, clipId: clip.id };
}

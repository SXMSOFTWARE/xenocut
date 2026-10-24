// Subtitles live as text clips on one text track marked `role: "subtitles"`, so they are
// styled, moved and exported exactly like any title, and can be regenerated in one step.
import { makeTrack, newTextClip, sortTracks } from "./ops";
import { applyPreset, textFromPreset } from "./text";
import type { Clip, Project, Track } from "./types";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Presets meant for spoken lines, offered first in the Subtitles panel. */
export const SUBTITLE_PRESETS = ["subtitle", "captionPop", "lyric", "clean", "headline", "comic"];

const MIN_CUE = 0.3;

/** Text tracks with a job: generated / imported subtitles, or song lyrics. */
export type LineRole = "subtitles" | "lyrics";

export function subtitleTrack(project: Project, role: LineRole = "subtitles"): Track | undefined {
  return project.tracks.find((t) => t.kind === "text" && t.role === role);
}

export function subtitleClips(project: Project, role: LineRole = "subtitles"): Clip[] {
  const track = subtitleTrack(project, role);
  if (!track) return [];
  return project.clips.filter((c) => c.trackId === track.id && c.text).sort((a, b) => a.start - b.start);
}

/** Cues as they stand on the timeline (after any edits), for SRT export. */
export function cuesFromProject(project: Project, role: LineRole = "subtitles"): Cue[] {
  return subtitleClips(project, role).map((c) => ({ start: c.start, end: c.start + (c.out - c.in) / (c.speed || 1), text: c.text!.content }));
}

/** Clean, ordered, non-overlapping cues; tiny or empty ones dropped. */
export function tidyCues(cues: Cue[]): Cue[] {
  const sorted = cues
    .map((c) => ({ start: Math.max(0, c.start), end: Math.max(0, c.end), text: c.text.replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: Cue[] = [];
  for (const cue of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.end > cue.start) prev.end = cue.start;
    if (prev && prev.end - prev.start < MIN_CUE) {
      // A cue squeezed to nothing by its successor merges into it instead of flashing.
      out.pop();
      out.push({ start: prev.start, end: Math.max(cue.end, prev.start + MIN_CUE), text: `${prev.text} ${cue.text}` });
      continue;
    }
    out.push({ ...cue, end: Math.max(cue.end, cue.start + MIN_CUE) });
  }
  return out;
}

/**
 * Replace the subtitles with `cues` styled by `presetId`. The subtitle track is created on
 * first use (named `trackName`); other text tracks are never touched.
 */
/** Characters per cue that suit a preset: punchy word-pop captions want short lines. */
export function maxCharsFor(presetId: string): number {
  return presetId === "captionPop" || presetId === "comic" ? 26 : 42;
}

/** Best guess for imported subtitles without a language tag: Turkish letters give it away. */
export function guessLang(cues: Cue[]): string | undefined {
  const sample = cues.slice(0, 40).map((c) => c.text).join(" ");
  return /[ğışĞİŞ]/.test(sample) ? "tr" : /[a-z]/i.test(sample) ? "und" : undefined;
}

export function setSubtitles(project: Project, cues: Cue[], presetId: string, trackName: string, lang?: string, role: LineRole = "subtitles"): Project {
  let track = subtitleTrack(project, role);
  let tracks = project.tracks;
  if (!track) {
    track = { ...makeTrack("text", tracks), name: trackName, role };
    tracks = sortTracks([...tracks, track]);
  }
  const id = track.id;
  const clips = tidyCues(cues).map((c) => newTextClip(id, c.start, { ...textFromPreset(presetId, c.text), ...(lang ? { lang } : {}) }, c.end - c.start));
  return { ...project, tracks, clips: [...project.clips.filter((c) => c.trackId !== id), ...clips] };
}

/** Re-style every subtitle with a preset, keeping words and timing. */
export function restyleSubtitles(project: Project, presetId: string, role: LineRole = "subtitles"): Project {
  const track = subtitleTrack(project, role);
  if (!track) return project;
  return {
    ...project,
    clips: project.clips.map((c) => (c.trackId === track.id && c.text ? { ...c, text: applyPreset(c.text, presetId) } : c)),
  };
}

export function clearSubtitles(project: Project, role: LineRole = "subtitles"): Project {
  const track = subtitleTrack(project, role);
  if (!track) return project;
  return { ...project, tracks: project.tracks.filter((t) => t.id !== track.id), clips: project.clips.filter((c) => c.trackId !== track.id) };
}

/** Moves every line of a role by `delta` seconds (lyrics sync nudge); never before 0. */
export function shiftLines(project: Project, delta: number, role: LineRole): Project {
  const track = subtitleTrack(project, role);
  if (!track) return project;
  const first = Math.min(...project.clips.filter((c) => c.trackId === track.id).map((c) => c.start));
  const d = Math.max(-first, delta);
  return { ...project, clips: project.clips.map((c) => (c.trackId === track.id ? { ...c, start: c.start + d } : c)) };
}

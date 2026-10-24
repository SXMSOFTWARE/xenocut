// Clip editing commands shared by the keyboard shortcuts and the context menus. Every command
// is one undo step (`commit`). Clips on locked tracks are never changed.
import { create } from "zustand";
import { engine } from "../../engine/playback";
import { uid } from "../../lib/id";
import { addEffectLayer, clipDuration, clipEnd, isFree, makeTrack, maxSourceOut, MIN_CLIP_SECONDS, nearestFreeStart, sortTracks, trackAccepts, updateClip } from "../../project/ops";
import type { Clip, Project, Track, TrackKind } from "../../project/types";
import { DEFAULT_DURATION, joins } from "../../transitions/index";
import { useProject } from "../../store/project";

/** What the clipboard holds (shown as enabled / disabled paste items). */
interface ClipboardState {
  clips: Clip[];
  /** Effects / animation / LUT / look of one clip (Ctrl+Alt+C). */
  attrs: Attributes | null;
}

export interface Attributes {
  effects?: Clip["effects"];
  anim?: Clip["anim"];
  lut?: Clip["lut"];
  opacity: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  textStyle?: NonNullable<Clip["text"]>["style"];
}

export const useClipboard = create<ClipboardState>(() => ({ clips: [], attrs: null }));

const clone = <T,>(v: T): T => structuredClone(v);

export function isLocked(p: Project, clip: Clip): boolean {
  return !!p.tracks.find((t) => t.id === clip.trackId)?.locked;
}

/** Selected clips that may be edited (not on a locked track). */
export function editableSelection(p: Project = useProject.getState().project!): Clip[] {
  if (!p) return [];
  const ids = new Set(useProject.getState().selection);
  return p.clips.filter((c) => ids.has(c.id) && !isLocked(p, c));
}

function selectedClips(p: Project): Clip[] {
  const ids = new Set(useProject.getState().selection);
  return p.clips.filter((c) => ids.has(c.id));
}

export function copySelection(): boolean {
  const p = useProject.getState().project;
  if (!p) return false;
  const clips = selectedClips(p);
  if (!clips.length) return false;
  useClipboard.setState({ clips: clone(clips) });
  return true;
}

export function cutSelection() {
  if (!copySelection()) return;
  deleteClips(editableSelection().map((c) => c.id));
}

export function deleteClips(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  useProject.getState().commit((p) => ({ ...p, clips: p.clips.filter((c) => !gone.has(c.id) || isLocked(p, c)) }));
  useProject.getState().select([]);
}

/** Track a pasted clip goes to: its own when it still exists and fits, else the first one that does. */
function trackFor(p: Project, clip: Clip, tracks: Track[]): Track | null {
  const fits = (t: Track) => {
    if (t.locked) return false;
    if (clip.text) return t.kind === "text";
    if (!clip.mediaId) return t.kind === "effect";
    const media = p.media.find((m) => m.id === clip.mediaId);
    return !!media && trackAccepts(t.kind, media);
  };
  const own = tracks.find((t) => t.id === clip.trackId);
  if (own && fits(own)) return own;
  return tracks.find(fits) ?? null;
}

/** Puts copies of `clips` at `at` (keeping their spacing). Returns the new ids. */
function place(clips: Clip[], at: number): string[] {
  if (!clips.length) return [];
  const base = Math.min(...clips.map((c) => c.start));
  const ids: string[] = [];
  useProject.getState().commit((p) => {
    // Media removed since copying can't be pasted.
    const usable = clips.filter((c) => !c.mediaId || p.media.some((m) => m.id === c.mediaId));
    let tracks = p.tracks;
    let next: Project = p;
    for (const src of usable) {
      let track = trackFor(next, src, tracks);
      if (!track) {
        const kind: TrackKind = src.text ? "text" : !src.mediaId ? "effect" : "video";
        track = makeTrack(kind, tracks);
        tracks = sortTracks([...tracks, track]);
        next = { ...next, tracks };
      }
      const clip: Clip = { ...clone(src), id: uid("c"), trackId: track.id };
      const start = nearestFreeStart(next, track.id, at + (src.start - base), clipDuration(clip));
      clip.start = start;
      next = { ...next, clips: [...next.clips, clip] };
      ids.push(clip.id);
    }
    return ids.length ? next : p;
  });
  if (ids.length) useProject.getState().select(ids);
  return ids;
}

export function paste() {
  place(useClipboard.getState().clips, engine.now());
}

/** Ctrl+D: copies right after the selection. */
export function duplicateSelection() {
  const p = useProject.getState().project;
  if (!p) return;
  const clips = selectedClips(p);
  if (!clips.length) return;
  place(clone(clips), Math.max(...clips.map(clipEnd)));
}

export function selectAll() {
  const p = useProject.getState().project;
  if (p) useProject.getState().select(p.clips.filter((c) => !isLocked(p, c)).map((c) => c.id));
}

function attributesOf(clip: Clip): Attributes {
  return clone({
    effects: clip.effects,
    anim: clip.anim,
    lut: clip.lut,
    opacity: clip.opacity,
    volume: clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    textStyle: clip.text?.style,
  });
}

/** Ctrl+Alt+C: effects and attributes of the (first) selected clip. */
export function copyAttributes(): boolean {
  const p = useProject.getState().project;
  const clip = p && selectedClips(p)[0];
  if (!clip) return false;
  useClipboard.setState({ attrs: attributesOf(clip) });
  return true;
}

function patchSelection(patch: (clip: Clip) => Partial<Clip> | null) {
  const targets = editableSelection();
  if (!targets.length) return;
  useProject.getState().commit((p) => {
    let next = p;
    for (const c of targets) {
      const change = patch(c);
      if (change) next = updateClip(next, c.id, change);
    }
    return next;
  });
}

/** Pastes only the effects (and LUT) onto the selection. */
export function pasteEffects() {
  const a = useClipboard.getState().attrs;
  if (!a) return;
  patchSelection((c) => (c.text ? null : { effects: clone(a.effects), lut: clone(a.lut) }));
}

/** Ctrl+Alt+V: effects, animation, LUT, opacity, volume, fades (and text style for text). */
export function pasteAttributes() {
  const a = useClipboard.getState().attrs;
  if (!a) return;
  patchSelection((c) => {
    const len = clipDuration(c);
    const out: Partial<Clip> = {
      opacity: a.opacity,
      volume: a.volume,
      fadeIn: Math.min(a.fadeIn, len / 2),
      fadeOut: Math.min(a.fadeOut, len / 2),
      anim: clone(a.anim),
    };
    if (!c.text) {
      out.effects = clone(a.effects);
      out.lut = clone(a.lut);
    } else if (a.textStyle) out.text = { ...c.text, style: clone(a.textStyle) };
    return out;
  });
}

export function resetEffects() {
  patchSelection((c) => (c.mediaId || c.text ? { effects: undefined, lut: undefined, anim: undefined } : null));
}

/** Speed with the end clamped so the clip never runs into the next one. */
export function setSpeed(speed: number) {
  const p = useProject.getState().project;
  if (!p) return;
  patchSelection((c) => {
    const media = p.media.find((m) => m.id === c.mediaId);
    if (!media || media.kind === "image") return null;
    const next = p.clips.filter((o) => o.trackId === c.trackId && o.id !== c.id && o.start >= clipEnd(c) - 1e-6).reduce((m, o) => Math.min(m, o.start), Infinity);
    const room = next - c.start;
    let out = c.out;
    if ((out - c.in) / speed > room) out = c.in + room * speed;
    out = Math.min(out, maxSourceOut(media));
    if ((out - c.in) / speed < MIN_CLIP_SECONDS) return null;
    return { speed, out };
  });
}

export function toggleClipMute() {
  const targets = editableSelection();
  const allMuted = targets.every((c) => c.volume === 0);
  patchSelection((c) => (c.text || !c.mediaId ? null : { volume: allMuted ? 1 : 0 }));
}

/** Video clips with sound: the sound moves to its own clip on an audio track (the video goes silent). */
export function detachAudio() {
  const ids: string[] = [];
  useProject.getState().commit((p) => {
    let next = p;
    for (const c of editableSelection(p)) {
      const media = p.media.find((m) => m.id === c.mediaId);
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (!media || media.kind !== "video" || !media.hasAudio || track?.kind !== "video" || c.volume === 0) continue;
      const len = clipDuration(c);
      let target = next.tracks.find((t) => t.kind === "audio" && !t.locked && isFree(next, t.id, c.start, len));
      if (!target) {
        target = makeTrack("audio", next.tracks);
        next = { ...next, tracks: sortTracks([...next.tracks, target]) };
      }
      const audio: Clip = { id: uid("c"), trackId: target.id, mediaId: c.mediaId, start: c.start, in: c.in, out: c.out, speed: c.speed, volume: c.volume, opacity: 1, fadeIn: c.fadeIn, fadeOut: c.fadeOut };
      next = updateClip({ ...next, clips: [...next.clips, audio] }, c.id, { volume: 0 });
      ids.push(audio.id);
    }
    return next;
  });
  if (ids.length) useProject.getState().select(ids);
}

export function renameClip(id: string, name: string) {
  useProject.getState().commit((p) => updateClip(p, id, { name: name.trim() || undefined }));
}

export function renameTrack(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  useProject.getState().commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, name: n } : t)) }));
}

export function toggleTrackFlag(id: string, key: "muted" | "hidden" | "locked") {
  useProject.getState().commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, [key]: !t[key] } : t)) }));
}

/** Tracks every selected clip could move to. */
export function moveTargets(p: Project, clips: Clip[]): Track[] {
  return p.tracks.filter((t) => !t.locked && clips.every((c) => trackFor(p, c, [t])?.id === t.id));
}

export function moveToTrack(trackId: string) {
  const targets = editableSelection();
  useProject.getState().commit((p) => {
    let next = p;
    const ignore = new Set(targets.map((c) => c.id));
    for (const c of targets) {
      if (c.trackId === trackId) continue;
      const start = nearestFreeStart(next, trackId, c.start, clipDuration(c), ignore);
      next = updateClip(next, c.id, { trackId, start });
      ignore.delete(c.id);
    }
    return next;
  });
}

/** An empty effect layer over the selection (or 3 s at the playhead). */
export function addEffectLayerHere() {
  const p = useProject.getState().project;
  if (!p) return;
  const clips = selectedClips(p);
  const at = clips.length ? Math.min(...clips.map((c) => c.start)) : engine.now();
  const len = clips.length ? Math.max(...clips.map(clipEnd)) - at : undefined;
  let id = "";
  useProject.getState().commit((q) => {
    const out = addEffectLayer(q, [], at, len);
    id = out.clipId;
    return out.project;
  });
  if (id) useProject.getState().select([id]);
}

/** The clip right after `clip` on its track when they touch (a transition can join them). */
export function nextAdjacent(p: Project, clip: Clip): Clip | null {
  const end = clipEnd(clip);
  return p.clips.find((c) => c.trackId === clip.trackId && c.id !== clip.id && Math.abs(c.start - end) < 0.02) ?? null;
}

/** Adds a dissolve between each selected clip and the next one (the browser can change it). */
export function addTransition(id = "fade") {
  patchSelection((c) => {
    const p = useProject.getState().project!;
    if (!c.mediaId || c.text || !nextAdjacent(p, c)) return null;
    return { transition: { id, duration: c.transition?.duration ?? DEFAULT_DURATION } };
  });
}

export function removeTransition() {
  patchSelection((c) => (c.transition ? { transition: undefined } : null));
}

export function hasJoin(p: Project, clip: Clip): boolean {
  return joins(p.clips, p.tracks).has(clip.id);
}

// ---- markers and in / out ----

export function addMarker() {
  const t = engine.now();
  useProject.getState().commit((p) => {
    const markers = p.markers ?? [];
    if (markers.some((m) => Math.abs(m.time - t) < 1e-3)) return p;
    return { ...p, markers: [...markers, { id: uid("mk"), time: t }].sort((a, b) => a.time - b.time) };
  });
}

export function removeMarkerNear(t: number, within: number) {
  useProject.getState().commit((p) => {
    const markers = p.markers ?? [];
    const keep = markers.filter((m) => Math.abs(m.time - t) > within);
    return keep.length === markers.length ? p : { ...p, markers: keep };
  });
}

export function setRangeEdge(edge: "in" | "out") {
  const t = engine.now();
  useProject.getState().commit((p) => {
    const r = p.range ?? { in: 0, out: Infinity };
    let next = { ...r, [edge]: t };
    if (next.in >= next.out) next = edge === "in" ? { in: t, out: Infinity } : { in: 0, out: t };
    const end = Number.isFinite(next.out) ? next.out : 1e9;
    return { ...p, range: { in: next.in, out: end } };
  });
}

export function clearRange() {
  useProject.getState().commit((p) => (p.range ? { ...p, range: undefined } : p));
}

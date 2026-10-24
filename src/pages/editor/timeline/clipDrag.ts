// Pointer gestures on timeline clips: move (also across compatible tracks), trim start, trim end.
// The whole gesture is one undo step; overlaps are resolved on release.
import {
  clipDuration,
  clipEnd,
  isEffectLayer,
  isElastic,
  isFree,
  maxSourceOut,
  MIN_CLIP_SECONDS,
  nearestFreeStart,
  snap,
  snapCandidates,
  trackAccepts,
  updateClip,
} from "../../../project/ops";
import type { Clip, Project, TrackKind } from "../../../project/types";
import { visibleBeats } from "../../../store/beats";
import { useEditorUi } from "../../../store/editorUi";
import { usePlayback } from "../../../store/playback";
import { useProject } from "../../../store/project";
import { laneAtPoint } from "./geometry";

export type ClipDragMode = "move" | "trim-start" | "trim-end";

const EPS = 1e-6;

export function beginClipDrag(e: React.PointerEvent, clipId: string, mode: ClipDragMode) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useProject.getState();
  const project = store.project;
  const origin = project?.clips.find((c) => c.id === clipId);
  const media = origin ? project?.media.find((m) => m.id === origin.mediaId) ?? null : null;
  const layer = !!origin && isEffectLayer(origin);
  if (!project || !origin || (!media && !origin.text && !layer)) return;
  const elastic = isElastic(origin, media);
  const fits = (kind: TrackKind) => (origin.text ? kind === "text" : layer ? kind === "effect" : !!media && trackAccepts(kind, media));

  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const wasSelected = store.selection.includes(clipId);
  if (additive) {
    store.select(wasSelected ? store.selection.filter((id) => id !== clipId) : [...store.selection, clipId]);
    return;
  }
  if (!wasSelected) store.select([clipId]);
  // Touch: the first tap only selects, so a swipe over clips still scrolls the timeline; a
  // selected clip (touch-action: none) can then be dragged or trimmed.
  if (e.pointerType === "touch" && !wasSelected) return;
  // Locked tracks select but never edit.
  if (project.tracks.find((t) => t.id === origin.trackId)?.locked) return;
  if (mode === "move" && wasSelected) {
    const sel = new Set(store.selection);
    const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
    const group = project.clips.filter((c) => sel.has(c.id) && c.id !== clipId && !locked.has(c.trackId));
    if (group.length) return beginGroupDrag(e, origin, group);
  }

  const ui = useEditorUi.getState();
  const pps = ui.pxPerSec;
  const threshold = 8 / pps;
  const ignore = new Set([clipId]);
  const candidates = snapCandidates(project, usePlayback.getState().time, ignore, visibleBeats(project, ignore));
  const sx = e.clientX;
  const duration = clipDuration(origin);
  const end = clipEnd(origin);
  const siblings = project.clips.filter((c) => c.trackId === origin.trackId && c.id !== clipId);
  const prevEnd = siblings.reduce((m, c) => (clipEnd(c) <= origin.start + EPS ? Math.max(m, clipEnd(c)) : m), 0);
  const nextStart = siblings.reduce((m, c) => (c.start >= end - EPS ? Math.min(m, c.start) : m), Number.POSITIVE_INFINITY);
  const minLen = MIN_CLIP_SECONDS;
  let moved = false;
  let trackId = origin.trackId;

  const snapTo = (time: number) => {
    if (!useEditorUi.getState().snapping) return { time, snapped: null as number | null };
    return snap(time, candidates, threshold);
  };

  store.beginGesture();

  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - sx) < 3 && mode !== "move") return;
    if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - e.clientY) < 3) return;
    moved = true;
    const dx = (ev.clientX - sx) / pps;
    let snapLine: number | null = null;

    if (mode === "move") {
      let start = Math.max(0, origin.start + dx);
      const head = snapTo(start);
      const tail = snapTo(start + duration);
      if (head.snapped !== null) {
        start = head.time;
        snapLine = head.snapped;
      } else if (tail.snapped !== null) {
        start = Math.max(0, tail.time - duration);
        snapLine = tail.snapped;
      }
      const lane = laneAtPoint(ev.clientX, ev.clientY);
      const current = useProject.getState().project;
      const target = lane?.trackId && current?.tracks.find((t) => t.id === lane.trackId);
      if (target && fits(target.kind) && !target.locked) trackId = target.id;
      useProject.getState().transient((p) => updateClip(p, clipId, { start, trackId }));
    } else if (mode === "trim-start") {
      const s = snapTo(origin.start + dx);
      let start = s.time;
      snapLine = s.snapped;
      const earliest = elastic ? prevEnd : Math.max(prevEnd, origin.start - origin.in / origin.speed);
      start = Math.min(Math.max(start, earliest), end - minLen);
      if (start !== s.time) snapLine = null;
      const patch =
        elastic
          ? { start, in: 0, out: (end - start) * origin.speed }
          : { start, in: origin.in + (start - origin.start) * origin.speed };
      useProject.getState().transient((p) => updateClip(p, clipId, patch));
    } else {
      const s = snapTo(end + dx);
      const latest = Math.min(nextStart, origin.start + (maxSourceOut(media) - origin.in) / origin.speed);
      const newEnd = Math.min(Math.max(s.time, origin.start + minLen), latest);
      snapLine = newEnd === s.time ? s.snapped : null;
      useProject.getState().transient((p) => updateClip(p, clipId, { out: origin.in + (newEnd - origin.start) * origin.speed }));
    }
    useEditorUi.setState({ snapLine });
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    useEditorUi.setState({ snapLine: null });
    const state = useProject.getState();
    if (!moved) {
      state.cancelGesture();
      if (wasSelected && state.selection.length > 1) state.select([clipId]);
      return;
    }
    if (mode === "move") {
      const p = state.project!;
      const clip = p.clips.find((c) => c.id === clipId)!;
      if (!isFree(p, clip.trackId, clip.start, duration, ignore)) {
        const start = nearestFreeStart(p, clip.trackId, clip.start, duration, ignore);
        state.transient((q) => updateClip(q, clipId, { start }));
      }
    }
    state.endGesture();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/** Several selected clips move together: same time offset, same track offset (when every clip
 * fits the track it lands on), snapping by the grabbed clip; one undo step, overlaps resolved
 * on release by nudging the whole group, or the move is dropped. */
function beginGroupDrag(e: React.PointerEvent, origin: Clip, others: Clip[]) {
  const store = useProject.getState();
  const project = store.project!;
  const group = [origin, ...others];
  const ids = new Set(group.map((c) => c.id));
  const tracks = project.tracks;
  const index = new Map(tracks.map((t, i) => [t.id, i]));
  const kindOf = (c: Clip) => {
    const media = project.media.find((m) => m.id === c.mediaId) ?? null;
    return (kind: TrackKind) => (c.text ? kind === "text" : isEffectLayer(c) ? kind === "effect" : !!media && trackAccepts(kind, media));
  };
  const fits = new Map(group.map((c) => [c.id, kindOf(c)]));
  const pps = useEditorUi.getState().pxPerSec;
  const threshold = 8 / pps;
  const candidates = snapCandidates(project, usePlayback.getState().time, ids, visibleBeats(project, ids));
  const earliest = Math.min(...group.map((c) => c.start));
  const duration = clipDuration(origin);
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  let shift = 0;
  let rows = 0;

  const place = (q: Project, dt: number, dr: number) => {
    const byId = new Map(group.map((c) => [c.id, c]));
    return {
      ...q,
      clips: q.clips.map((c) => {
        const o = byId.get(c.id);
        if (!o) return c;
        return { ...c, start: o.start + dt, trackId: tracks[index.get(o.trackId)! + dr].id };
      }),
    };
  };
  const rowsOk = (dr: number) =>
    group.every((c) => {
      const t = tracks[index.get(c.trackId)! + dr];
      return !!t && !t.locked && fits.get(c.id)!(t.kind);
    });

  store.beginGesture();
  const move = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
    moved = true;
    let dt = Math.max(-earliest, (ev.clientX - sx) / pps);
    let snapLine: number | null = null;
    if (useEditorUi.getState().snapping) {
      const head = snap(origin.start + dt, candidates, threshold);
      const tail = snap(origin.start + dt + duration, candidates, threshold);
      if (head.snapped !== null) (dt = head.time - origin.start), (snapLine = head.snapped);
      else if (tail.snapped !== null) (dt = tail.time - duration - origin.start), (snapLine = tail.snapped);
      dt = Math.max(-earliest, dt);
    }
    const lane = laneAtPoint(ev.clientX, ev.clientY);
    if (lane?.trackId && index.has(lane.trackId)) {
      const dr = index.get(lane.trackId)! - index.get(origin.trackId)!;
      if (rowsOk(dr)) rows = dr;
    }
    shift = dt;
    useProject.getState().transient((q) => place(q, shift, rows));
    useEditorUi.setState({ snapLine });
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    useEditorUi.setState({ snapLine: null });
    const state = useProject.getState();
    if (!moved) {
      state.cancelGesture();
      state.select([origin.id]);
      return;
    }
    // Nudge the whole group right until nothing overlaps (a few tries), else give up.
    for (let i = 0; i < 8; i++) {
      const q = state.project!;
      const hit = q.clips.find((c) => ids.has(c.id) && !isFree(q, c.trackId, c.start, clipDuration(c), ids));
      if (!hit) return state.endGesture();
      const free = nearestFreeStart(q, hit.trackId, hit.start, clipDuration(hit), ids);
      const nudge = free - hit.start;
      if (Math.abs(nudge) < EPS || earliest + shift + nudge < -EPS) break;
      shift += nudge;
      state.transient((p) => place(p, shift, rows));
    }
    state.cancelGesture();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

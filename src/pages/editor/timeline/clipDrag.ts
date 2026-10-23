// Pointer gestures on timeline clips: move (also across compatible tracks), trim start, trim end.
// The whole gesture is one undo step; overlaps are resolved on release.
import {
  clipDuration,
  clipEnd,
  isFree,
  maxSourceOut,
  MIN_CLIP_SECONDS,
  nearestFreeStart,
  snap,
  snapCandidates,
  trackAccepts,
  updateClip,
} from "../../../project/ops";
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
  const media = origin && project?.media.find((m) => m.id === origin.mediaId);
  if (!project || !origin || !media) return;

  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const wasSelected = store.selection.includes(clipId);
  if (additive) {
    store.select(wasSelected ? store.selection.filter((id) => id !== clipId) : [...store.selection, clipId]);
    return;
  }
  if (!wasSelected) store.select([clipId]);

  const ui = useEditorUi.getState();
  const pps = ui.pxPerSec;
  const threshold = 8 / pps;
  const ignore = new Set([clipId]);
  const candidates = snapCandidates(project, usePlayback.getState().time, ignore);
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
      if (target && trackAccepts(target.kind, media)) trackId = target.id;
      useProject.getState().transient((p) => updateClip(p, clipId, { start, trackId }));
    } else if (mode === "trim-start") {
      const s = snapTo(origin.start + dx);
      let start = s.time;
      snapLine = s.snapped;
      const earliest = media.kind === "image" ? prevEnd : Math.max(prevEnd, origin.start - origin.in / origin.speed);
      start = Math.min(Math.max(start, earliest), end - minLen);
      if (start !== s.time) snapLine = null;
      const patch =
        media.kind === "image"
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

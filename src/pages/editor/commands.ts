// Editor commands shared by shortcuts, toolbar buttons and the inspector.
import { engine } from "../../engine/playback";
import { clipEnd, clipsAt, makeTrack, sortTracks, splitClip } from "../../project/ops";
import type { TrackKind } from "../../project/types";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useEditorUi } from "../../store/editorUi";

export function splitAtPlayhead() {
  const { project, selection, commit, select } = useProject.getState();
  if (!project) return;
  const time = usePlayback.getState().time;
  const under = clipsAt(project, time);
  const targets = selection.length ? under.filter((c) => selection.includes(c.id)) : under;
  if (!targets.length) return;
  const newIds: string[] = [];
  commit((p) => {
    let next = p;
    for (const clip of targets) {
      const result = splitClip(next, clip.id, time);
      next = result.project;
      if (result.rightId) newIds.push(result.rightId);
    }
    return next;
  });
  if (newIds.length) select(newIds);
}

export function deleteSelection() {
  const { project, selection, commit, select } = useProject.getState();
  if (!project || !selection.length) return;
  const ids = new Set(selection);
  commit((p) => ({ ...p, clips: p.clips.filter((c) => !ids.has(c.id)) }));
  select([]);
}

export function addTrack(kind: TrackKind) {
  useProject.getState().commit((p) => {
    const track = makeTrack(kind, p.tracks);
    return { ...p, tracks: sortTracks([...p.tracks, track]) };
  });
}

export function removeTrack(trackId: string) {
  useProject.getState().commit((p) => ({
    ...p,
    tracks: p.tracks.filter((t) => t.id !== trackId),
    clips: p.clips.filter((c) => c.trackId !== trackId),
  }));
}

export function toggleTrack(trackId: string, key: "muted" | "hidden") {
  useProject.getState().commit((p) => ({
    ...p,
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, [key]: !t[key] } : t)),
  }));
}

export function zoomBy(factor: number) {
  const ui = useEditorUi.getState();
  ui.setZoom(ui.pxPerSec * factor);
}

export function jumpToEdge(direction: -1 | 1) {
  const { project } = useProject.getState();
  if (!project) return;
  const time = usePlayback.getState().time;
  const edges = new Set<number>([0]);
  for (const c of project.clips) {
    edges.add(c.start);
    edges.add(clipEnd(c));
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const target = direction > 0 ? sorted.find((e) => e > time + 1e-3) : [...sorted].reverse().find((e) => e < time - 1e-3);
  if (target !== undefined) engine.seek(target);
}

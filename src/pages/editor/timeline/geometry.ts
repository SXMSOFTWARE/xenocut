import { useEditorUi } from "../../../store/editorUi";

export interface LaneHit {
  /** null when over the "new track" drop zone. */
  trackId: string | null;
  time: number;
}

/** The timeline lane under a viewport point, with the timeline time at that x. */
export function laneAtPoint(x: number, y: number): LaneHit | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-lane]");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const pps = useEditorUi.getState().pxPerSec;
  return { trackId: el.dataset.trackId || null, time: Math.max(0, (x - rect.left) / pps) };
}

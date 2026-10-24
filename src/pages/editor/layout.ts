import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useEditorUi } from "../../store/editorUi";
import { clampPanelWidth, clampTimelineFrac, PANEL_W, TIMELINE_FRAC, useSettings } from "../../store/settings";

export type LayoutPreset = "classic" | "left" | "studio" | "focus";
export const LAYOUT_PRESETS: LayoutPreset[] = ["classic", "left", "studio", "focus"];

/** The large-timeline preset gives the tracks a bit under half the editor. */
const STUDIO_FRAC = 0.46;

/** Which preset the current arrangement matches, if any. */
export function currentPreset(s: { panelSide: string; timelineFrac: number }, ui: { panel: unknown; timelineCollapsed: boolean }): LayoutPreset | null {
  if (ui.timelineCollapsed && !ui.panel) return "focus";
  if (ui.timelineCollapsed) return null;
  if (s.panelSide === "left") return "left";
  if (s.timelineFrac === 0) return "classic";
  if (Math.abs(s.timelineFrac - STUDIO_FRAC) < 0.005) return "studio";
  return null;
}

export function applyPreset(preset: LayoutPreset) {
  const settings = useSettings.getState();
  const ui = useEditorUi.getState();
  if (preset === "focus") {
    useEditorUi.setState({ panel: null, timelineCollapsed: true });
    return;
  }
  useEditorUi.setState({ timelineCollapsed: false, panel: ui.panel ?? "media" });
  if (preset === "classic") settings.update({ panelSide: "right", timelineFrac: 0, panelWidth: 0 });
  else if (preset === "left") settings.update({ panelSide: "left" });
  else settings.update({ panelSide: "right", timelineFrac: STUDIO_FRAC });
}

export function resetSizes() {
  useSettings.getState().update({ panelWidth: 0, timelineFrac: 0 });
}

/** CSS variables the editor root carries for user-sized parts. */
export function layoutVars(panelWidth: number): CSSProperties | undefined {
  return panelWidth ? ({ "--panel-w-user": `${panelWidth}px` } as CSSProperties) : undefined;
}

/**
 * Drag helper: live values go straight into the store (no disk write per move);
 * the final value is saved once on release.
 */
function drag(e: ReactPointerEvent<HTMLElement>, cursor: string, onMove: (ev: PointerEvent) => Partial<{ panelWidth: number; timelineFrac: number }>) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("is-resizing");
  document.body.style.cursor = cursor;
  let last: Partial<{ panelWidth: number; timelineFrac: number }> = {};
  const move = (ev: PointerEvent) => {
    last = onMove(ev);
    useSettings.setState(last);
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    document.body.classList.remove("is-resizing");
    document.body.style.cursor = "";
    if (Object.keys(last).length) useSettings.getState().update(last);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

/** Top edge of the timeline: drag to give the tracks more or less of the editor. */
export function timelineResizeDown(e: ReactPointerEvent<HTMLElement>) {
  const hero = e.currentTarget.closest<HTMLElement>(".hero");
  if (!hero) return;
  drag(e, "ns-resize", (ev) => {
    const r = hero.getBoundingClientRect();
    const frac = (r.bottom - ev.clientY) / r.height;
    return { timelineFrac: clampTimelineFrac(Math.min(TIMELINE_FRAC.max, Math.max(TIMELINE_FRAC.min, frac))) };
  });
}

/** Inner edge of the tool panel: drag to widen it. */
export function panelResizeDown(e: ReactPointerEvent<HTMLElement>) {
  const panel = e.currentTarget.closest<HTMLElement>(".side-panel");
  if (!panel) return;
  const left = useSettings.getState().panelSide === "left";
  const r = panel.getBoundingClientRect();
  drag(e, "ew-resize", (ev) => {
    const w = left ? ev.clientX - r.left : r.right - ev.clientX;
    return { panelWidth: clampPanelWidth(Math.min(PANEL_W.max, Math.max(PANEL_W.min, w))) };
  });
}

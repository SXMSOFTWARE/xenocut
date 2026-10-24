import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { isMobileUi } from "../../../lib/platform";
import { AudioLines, Film, Magnet, Maximize2, Music2, Plus, Scissors, Trash2, Type, ZoomIn, ZoomOut } from "lucide-react";
import { useT } from "../../../i18n";
import { NEW_TRACK } from "../../../project/actions";
import { projectDuration } from "../../../project/ops";
import type { Clip } from "../../../project/types";
import { useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { useSettings } from "../../../store/settings";
import { timelineResizeDown } from "../layout";
import { addTrack, deleteSelection, fitTimeline, splitAtPlayhead, zoomBy } from "../commands";
import { Playhead, SnapLine } from "./Playhead";
import { Ruler } from "./Ruler";
import { Scrubber } from "./Scrubber";
import { lanePointerDown, TrackRow } from "./TrackRow";

export const HEADER_W = 44;
const NARROW = "(max-width: 860px), (max-height: 600px)";

/** Phones/short windows drop the track header column, like the reference's mobile layout. */
function useHeaderWidth() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow ? 0 : HEADER_W;
}
// Bigger rows on the touch UI: clips are tapped, not clicked.
const VIDEO_H = isMobileUi ? 58 : 46;
const AUDIO_H = isMobileUi ? 42 : 32;

/**
 * Compact timeline overlaid on the bottom of the preview: a thin overview scrubber with the
 * "< >" handle, a dotted ruler and pill clip strips. Collapsing leaves only the scrubber row.
 */
export function Timeline() {
  const t = useT();
  const tracks = useProject((s) => s.project?.tracks);
  const clips = useProject((s) => s.project?.clips);
  const mediaList = useProject((s) => s.project?.media);
  const hasSelection = useProject((s) => s.selection.length > 0);
  const pps = useEditorUi((s) => s.pxPerSec);
  const snapping = useEditorUi((s) => s.snapping);
  const collapsed = useEditorUi((s) => s.timelineCollapsed);
  const tlFrac = useSettings((s) => s.timelineFrac);
  const dragging = useEditorUi((s) => !!s.dragMedia);
  const newHint = useEditorUi((s) => (s.dropHint?.trackId === NEW_TRACK ? s.dropHint : null));
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(800);
  const [addOpen, setAddOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const anchor = useRef<{ time: number; x: number } | null>(null);
  const headerW = useHeaderWidth();

  const duration = useMemo(() => (clips ? projectDuration({ clips } as never) : 0), [clips]);
  const media = useMemo(() => new Map((mediaList ?? []).map((m) => [m.id, m])), [mediaList]);
  const byTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const c of clips ?? []) {
      const list = map.get(c.trackId);
      if (list) list.push(c);
      else map.set(c.trackId, [c]);
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start);
    return map;
  }, [clips]);

  const laneW = Math.max(viewW - headerW, (duration + 20) * pps);

  // Tell the hero how tall we are, so the stage is fitted above us.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const hero = el?.closest<HTMLElement>(".hero");
    if (!el || !hero) return;
    const report = () => hero.style.setProperty("--tl-h", `${el.offsetHeight}px`);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => setViewW(scroller.clientWidth));
    ro.observe(scroller);
    setViewW(scroller.clientWidth);
    // Ctrl + wheel zooms around the cursor; plain wheel scrolls (shift = horizontal).
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = scroller.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left - headerW);
      const ui = useEditorUi.getState();
      anchor.current = { time: (scroller.scrollLeft + x) / ui.pxPerSec, x };
      ui.setZoom(ui.pxPerSec * Math.exp(-e.deltaY * 0.0015));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [scroller, headerW]);

  useLayoutEffect(() => {
    if (scroller && anchor.current) {
      scroller.scrollLeft = Math.max(0, anchor.current.time * pps - anchor.current.x);
      anchor.current = null;
    }
  }, [pps, scroller]);

  const zoomCentered = (factor: number) => {
    if (scroller) anchor.current = { time: (scroller.scrollLeft + (viewW - headerW) / 2) / pps, x: (viewW - headerW) / 2 };
    zoomBy(factor);
  };

  if (!tracks) return null;
  const counts = { video: 0, audio: 0, music: 0, text: 0 };
  for (const tr of tracks) counts[tr.kind] += 1;
  const mainVideo = tracks.find((tr) => tr.kind === "video")?.id;

  return (
    <section ref={rootRef} className={`timeline${headerW ? "" : " no-headers"}${dragging ? " is-dragging" : ""}${collapsed ? " collapsed" : ""}${tlFrac && !collapsed ? " sized" : ""}`} style={tlFrac && !collapsed ? ({ "--tl-frac": tlFrac } as CSSProperties) : undefined}>
      {!collapsed && <div className="tl-resize" onPointerDown={timelineResizeDown} onDoubleClick={() => useSettings.getState().update({ timelineFrac: 0 })} title={t("layout.resizeTimeline")} aria-hidden />}
      <div className="tl-bar">
        <div className="tl-tools">
          <button className="tl-btn m-hide" onClick={splitAtPlayhead} title={`${t("inspector.split")} (S)`} aria-label={t("inspector.split")}>
            <Scissors />
          </button>
          <button className="tl-btn m-hide" onClick={deleteSelection} disabled={!hasSelection} title={`${t("inspector.delete")} (Del)`} aria-label={t("inspector.delete")}>
            <Trash2 />
          </button>
          <button
            className={`tl-btn${snapping ? " on" : ""}`}
            onClick={() => useEditorUi.setState({ snapping: !snapping })}
            title={t("timeline.snapping")}
            aria-label={t("timeline.snapping")}
            aria-pressed={snapping}
          >
            <Magnet />
          </button>
          <div className="tl-add-wrap">
            <button className={`tl-btn${addOpen ? " on" : ""}`} onClick={() => setAddOpen(!addOpen)} title={t("editor.addTrack")} aria-label={t("editor.addTrack")} aria-expanded={addOpen}>
              <Plus />
            </button>
            {addOpen && (
              <div className="menu tl-add-menu" onPointerLeave={() => setAddOpen(false)}>
                {(
                  [
                    ["video", Film],
                    ["audio", AudioLines],
                    ["music", Music2],
                    ["text", Type],
                  ] as const
                ).map(([kind, Icon]) => (
                  <button key={kind} className="menu-item" onClick={() => (addTrack(kind), setAddOpen(false))}>
                    <span className="menu-icon">
                      <Icon size={13} />
                    </span>
                    <span>{t(`track.${kind}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <Scrubber duration={duration} />
        <div className="tl-tools">
          <button className="tl-btn m-hide" onClick={() => zoomCentered(0.8)} aria-label={t("timeline.zoomOut")} title={t("timeline.zoomOut")}>
            <ZoomOut />
          </button>
          <button className="tl-btn m-hide" onClick={() => zoomCentered(1.25)} aria-label={t("timeline.zoomIn")} title={t("timeline.zoomIn")}>
            <ZoomIn />
          </button>
          <button className="tl-btn" onClick={fitTimeline} title={t("timeline.fit")} aria-label={t("timeline.fit")}>
            <Maximize2 />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="tl-scroll" ref={setScroller} style={{ "--track-header-w": `${headerW}px` } as React.CSSProperties}>
          <div className="tl-content" style={{ width: headerW + laneW }}>
            <div className="tl-ruler-row">
              <div className="tl-corner" />
              <Ruler pps={pps} scroller={scroller} contentWidth={laneW} />
            </div>
            {tracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                clips={byTrack.get(track.id) ?? EMPTY}
                media={media}
                pps={pps}
                height={track.kind === "video" ? VIDEO_H : AUDIO_H}
                canRemove={track.kind === "text" || counts[track.kind] > 1 || !(byTrack.get(track.id)?.length ?? 0)}
                showAdd={track.id === mainVideo}
              />
            ))}
            {dragging && (
              <div className="tl-row tl-new">
                <div className="tl-header">
                  <span className="tl-new-label">{t("timeline.newTrack")}</span>
                </div>
                <div className="tl-lane" data-lane="" data-track-id={NEW_TRACK} onPointerDown={lanePointerDown}>
                  {newHint && <div className="drop-hint" style={{ transform: `translateX(${newHint.start * pps}px)`, width: Math.max(4, newHint.duration * pps) }} />}
                </div>
              </div>
            )}
            <div className="tl-overlay" style={{ left: headerW }}>
              <SnapLine pps={pps} />
              <Playhead pps={pps} scroller={scroller} headerWidth={headerW} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const EMPTY: Clip[] = [];

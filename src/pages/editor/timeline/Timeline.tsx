import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Film, Magnet, Maximize2, Music2, Plus, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useT } from "../../../i18n";
import { NEW_TRACK } from "../../../project/actions";
import { projectDuration } from "../../../project/ops";
import type { Clip } from "../../../project/types";
import { MAX_PPS, MIN_PPS, useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { addTrack, deleteSelection, splitAtPlayhead } from "../commands";
import { Playhead, SnapLine } from "./Playhead";
import { Ruler } from "./Ruler";
import { lanePointerDown, TrackRow } from "./TrackRow";

const HEADER_W = 168;
const TRACK_H = 62;
const MUSIC_H = 50;

export function Timeline() {
  const t = useT();
  const tracks = useProject((s) => s.project?.tracks);
  const clips = useProject((s) => s.project?.clips);
  const mediaList = useProject((s) => s.project?.media);
  const hasSelection = useProject((s) => s.selection.length > 0);
  const pps = useEditorUi((s) => s.pxPerSec);
  const snapping = useEditorUi((s) => s.snapping);
  const dragging = useEditorUi((s) => !!s.dragMedia);
  const newHint = useEditorUi((s) => (s.dropHint?.trackId === NEW_TRACK ? s.dropHint : null));
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(800);
  const anchor = useRef<{ time: number; x: number } | null>(null);

  const duration = useMemo(() => (clips ? projectDuration({ clips } as never) : 0), [clips]);
  const media = useMemo(() => new Map((mediaList ?? []).map((m) => [m.id, m])), [mediaList]);
  const byTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    for (const c of clips ?? []) {
      const list = map.get(c.trackId);
      if (list) list.push(c);
      else map.set(c.trackId, [c]);
    }
    return map;
  }, [clips]);

  const laneW = Math.max(viewW - HEADER_W, (duration + 30) * pps);

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
      const x = Math.max(0, e.clientX - rect.left - HEADER_W);
      const ui = useEditorUi.getState();
      anchor.current = { time: (scroller.scrollLeft + x) / ui.pxPerSec, x };
      ui.setZoom(ui.pxPerSec * Math.exp(-e.deltaY * 0.0015));
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      scroller.removeEventListener("wheel", onWheel);
    };
  }, [scroller]);

  useLayoutEffect(() => {
    if (scroller && anchor.current) {
      scroller.scrollLeft = Math.max(0, anchor.current.time * pps - anchor.current.x);
      anchor.current = null;
    }
  }, [pps, scroller]);

  const fit = useCallback(() => {
    const target = duration > 0 ? (viewW - HEADER_W - 40) / duration : 40;
    useEditorUi.getState().setZoom(target);
    if (scroller) scroller.scrollLeft = 0;
  }, [duration, viewW, scroller]);

  // Zoom slider is logarithmic.
  const zoomValue = Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
  const setZoomFromSlider = (v: number) => {
    if (scroller) anchor.current = { time: (scroller.scrollLeft + (viewW - HEADER_W) / 2) / pps, x: (viewW - HEADER_W) / 2 };
    useEditorUi.getState().setZoom(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v));
  };

  if (!tracks) return null;
  const counts = { video: 0, audio: 0, music: 0 };
  for (const tr of tracks) counts[tr.kind] += 1;

  return (
    <section className={`timeline${dragging ? " is-dragging" : ""}`}>
      <div className="tl-toolbar">
        <button className="icon-btn sm" onClick={splitAtPlayhead} title={`${t("inspector.split")} (S)`} aria-label={t("inspector.split")}>
          <Scissors />
        </button>
        <button className="icon-btn sm" onClick={deleteSelection} disabled={!hasSelection} title={`${t("inspector.delete")} (Del)`} aria-label={t("inspector.delete")}>
          <Trash2 />
        </button>
        <button
          className={`icon-btn sm${snapping ? " active" : ""}`}
          onClick={() => useEditorUi.setState({ snapping: !snapping })}
          title={t("timeline.snapping")}
          aria-label={t("timeline.snapping")}
          aria-pressed={snapping}
        >
          <Magnet />
        </button>
        <span className="tl-sep" />
        <span className="tl-add">
          <Plus />
          <button className="chip" onClick={() => addTrack("video")}>
            <Film /> {t("track.video")}
          </button>
          <button className="chip" onClick={() => addTrack("audio")}>
            <AudioLines /> {t("track.audio")}
          </button>
          <button className="chip" onClick={() => addTrack("music")}>
            <Music2 /> {t("track.music")}
          </button>
        </span>
        <div className="spacer" />
        <button className="icon-btn sm flat" onClick={() => setZoomFromSlider(Math.max(0, zoomValue - 0.08))} aria-label={t("timeline.zoomOut")} title={t("timeline.zoomOut")}>
          <ZoomOut />
        </button>
        <input
          type="range"
          className="tl-zoom"
          min={0}
          max={1}
          step={0.001}
          value={zoomValue}
          onChange={(e) => setZoomFromSlider(Number(e.target.value))}
          style={{ "--fill": `${zoomValue * 100}%` } as React.CSSProperties}
          aria-label={t("timeline.zoom")}
        />
        <button className="icon-btn sm flat" onClick={() => setZoomFromSlider(Math.min(1, zoomValue + 0.08))} aria-label={t("timeline.zoomIn")} title={t("timeline.zoomIn")}>
          <ZoomIn />
        </button>
        <button className="icon-btn sm flat" onClick={fit} title={t("timeline.fit")} aria-label={t("timeline.fit")}>
          <Maximize2 />
        </button>
      </div>

      <div className="tl-scroll" ref={setScroller} style={{ "--track-header-w": `${HEADER_W}px` } as React.CSSProperties}>
        <div className="tl-content" style={{ width: HEADER_W + laneW }}>
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
              height={track.kind === "music" ? MUSIC_H : TRACK_H}
              canRemove={counts[track.kind] > 1 || !(byTrack.get(track.id)?.length ?? 0)}
            />
          ))}
          <div className="tl-row tl-new">
            <div className="tl-header">{dragging ? t("timeline.newTrack") : ""}</div>
            <div className="tl-lane" data-lane="" data-track-id={NEW_TRACK} onPointerDown={lanePointerDown}>
              {newHint && <div className="drop-hint" style={{ transform: `translateX(${newHint.start * pps}px)`, width: Math.max(4, newHint.duration * pps) }} />}
            </div>
          </div>
          <div className="tl-overlay" style={{ left: HEADER_W }}>
            <SnapLine pps={pps} />
            <Playhead pps={pps} scroller={scroller} headerWidth={HEADER_W} />
          </div>
        </div>
      </div>
    </section>
  );
}

const EMPTY: Clip[] = [];

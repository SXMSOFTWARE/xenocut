import { useEffect, useMemo, useRef } from "react";
import { rulerLabel } from "../../../lib/format";
import { pickBeats, timelineBeats } from "../../../project/beats";
import { songBeats, useBeats } from "../../../store/beats";
import { useProject } from "../../../store/project";
import { scrubFrom } from "./TrackRow";
import { engine } from "../../../engine/playback";
import { openMenu } from "../../../components/ContextMenu";
import { t as tr } from "../../../i18n";
import { clearRange } from "../edit";
import { projectDuration } from "../../../project/ops";

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

/** A viewport-sized canvas that sticks in place and draws only the visible range. */
export function Ruler({ pps, scroller, contentWidth }: { pps: number; scroller: HTMLDivElement | null; contentWidth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const project = useProject((st) => st.project);
  const grids = useBeats((st) => st.grids);
  const show = useBeats((st) => st.show);
  // Beat markers: every beat a short tick, bar starts (downbeats) taller.
  const beats = useMemo(() => {
    const song = show ? songBeats(project, grids) : null;
    if (!song?.grid) return null;
    const all = timelineBeats(song.clip, song.grid);
    const first = song.grid.beats.findIndex((b) => b >= song.clip.in - 1e-3);
    return { all, bars: new Set(pickBeats(all, 4, song.grid.downbeat, Math.max(0, first))) };
  }, [project, grids, show]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scroller) return;
    const ctx = canvas.getContext("2d")!;
    const raw = parseFloat(getComputedStyle(scroller).getPropertyValue("--track-header-w"));
    const headerW = Number.isFinite(raw) ? raw : 44;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, scroller.clientWidth - headerW);
      const h = canvas.clientHeight || 20;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const left = scroller.scrollLeft;
      const step = STEPS.find((s) => s * pps >= 80) ?? 3600;
      const minor = step / 5;
      const t0 = Math.floor(left / pps / minor) * minor;
      const t1 = (left + w) / pps;
      ctx.font = "500 10px Inter, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const mid = Math.round(h / 2);
      for (let i = 0, t = t0; t <= t1 + minor; i++, t = t0 + i * minor) {
        const x = Math.round(t * pps - left) + 0.5;
        const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        if (major) {
          ctx.fillStyle = "rgba(255,255,255,0.62)";
          ctx.fillText(rulerLabel(Math.max(0, t)), Math.max(12, x), mid);
        } else {
          // the reference's dotted ruler
          ctx.fillStyle = "rgba(255,255,255,0.32)";
          ctx.beginPath();
          ctx.arc(x, mid, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (beats) {
        ctx.fillStyle = "rgba(255,138,76,0.9)";
        for (const b of beats.all) {
          if (b < left / pps - 1 || b > t1 + 1) continue;
          const x = Math.round(b * pps - left);
          const bar = beats.bars.has(b);
          if (!bar && pps < 12) continue; // too dense to read when zoomed far out
          const th = bar ? 7 : 4;
          ctx.globalAlpha = bar ? 1 : 0.6;
          ctx.fillRect(x - (bar ? 1 : 0.5), h - th, bar ? 2 : 1, th);
        }
        ctx.globalAlpha = 1;
      }
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    scroller.addEventListener("scroll", request, { passive: true });
    const ro = new ResizeObserver(request);
    ro.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", request);
      ro.disconnect();
    };
  }, [pps, scroller, contentWidth, beats]);

  return (
    <div className="tl-ruler" ref={hostRef} style={{ width: contentWidth }} onPointerDown={(e) => e.button === 0 && scrubFrom(hostRef.current!, e.clientX)}>
      <canvas ref={canvasRef} />
      <RulerMarks pps={pps} />
    </div>
  );
}

/** In/out range band and markers over the ruler. Click a marker to jump; right-click to remove. */
function RulerMarks({ pps }: { pps: number }) {
  const markers = useProject((st) => st.project?.markers);
  const range = useProject((st) => st.project?.range);
  const end = useProject((st) => (st.project ? projectDuration(st.project) : 0));
  const out = range ? Math.min(range.out, Math.max(end, range.in)) : 0;
  const removeMarker = (id: string) =>
    useProject.getState().commit((p) => ({ ...p, markers: (p.markers ?? []).filter((m) => m.id !== id) }));
  return (
    <>
      {range && (
        <div
          className="tl-range"
          style={{ left: range.in * pps, width: Math.max(2, (out - range.in) * pps) }}
          onContextMenu={(e) => openMenu(e, [{ label: tr("sc.clearInOut"), run: clearRange }])}
        />
      )}
      {markers?.map((m) => (
        <button
          key={m.id}
          className="tl-marker"
          style={{ left: m.time * pps, ...(m.color ? { color: m.color } : null) }}
          title={m.label ?? rulerLabel(m.time)}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button === 0) engine.seek(m.time);
          }}
          onContextMenu={(e) => openMenu(e, [{ label: tr("menu.removeMarker"), danger: true, run: () => removeMarker(m.id) }])}
        />
      ))}
    </>
  );
}

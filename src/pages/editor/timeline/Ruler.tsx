import { useEffect, useRef } from "react";
import { rulerLabel } from "../../../lib/format";
import { scrubFrom } from "./TrackRow";

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];

/** A viewport-sized canvas that sticks in place and draws only the visible range. */
export function Ruler({ pps, scroller, contentWidth }: { pps: number; scroller: HTMLDivElement | null; contentWidth: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scroller) return;
    const ctx = canvas.getContext("2d")!;
    const headerW = parseFloat(getComputedStyle(scroller).getPropertyValue("--track-header-w")) || 168;
    let frame = 0;

    const draw = () => {
      frame = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, scroller.clientWidth - headerW);
      const h = canvas.clientHeight || 28;
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
      ctx.textBaseline = "top";
      for (let i = 0, t = t0; t <= t1 + minor; i++, t = t0 + i * minor) {
        const x = Math.round(t * pps - left) + 0.5;
        const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        ctx.fillStyle = major ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.12)";
        ctx.fillRect(x, major ? h - 10 : h - 5, 1, major ? 10 : 5);
        if (major) {
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.fillText(rulerLabel(Math.max(0, t)), x + 4, 6);
        }
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
  }, [pps, scroller, contentWidth]);

  return (
    <div className="tl-ruler" ref={hostRef} style={{ width: contentWidth }} onPointerDown={(e) => e.button === 0 && scrubFrom(hostRef.current!, e.clientX)}>
      <canvas ref={canvasRef} />
    </div>
  );
}

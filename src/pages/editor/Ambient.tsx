import { useEffect, useRef, useState } from "react";
import { usePosterThumb } from "./SidePanel";
import { useSettings } from "../../store/settings";

/**
 * The reference's full-bleed picture behind the UI.
 *
 * Everything behind the editor (the warm radial base, the stretched poster and the vignette) is
 * drawn once into a single canvas at the hero's pixel size. WebKitGTK without GPU compositing
 * repaints the area around the video on every video frame; re-evaluating three CSS gradients and
 * a scaled image there cost more than half the frame budget, a 1:1 canvas blit costs almost
 * nothing. Redrawn only on resize or when the poster changes.
 */
export function Ambient() {
  const src = usePosterThumb();
  const lite = useSettings((s) => s.performanceMode);
  const [poster, setPoster] = useState<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!src || lite) return setPoster(null);
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!alive) return;
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 14;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        ctx.getImageData(0, 0, 1, 1); // throws on a tainted canvas (asset:// fallback)
        setPoster(c);
      } catch {
        setPoster(null); // keep the plain warm gradient
      }
    };
    img.onerror = () => alive && setPoster(null);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, lite]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(host.clientWidth * dpr));
      const h = Math.max(1, Math.round(host.clientHeight * dpr));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      paintBackdrop(ctx, w, h, poster);
      // The preview's soft drop shadow, painted here once instead of by .stage on every frame.
      const stage = host.querySelector<HTMLElement>(".stage");
      if (stage && !useSettings.getState().performanceMode) {
        const hr = host.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        if (sr.width > 0 && sr.height > 0) paintStageShadow(ctx, dpr, sr.left - hr.left, sr.top - hr.top, sr.width, sr.height);
      }
      setReady(true);
    };
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    draw();
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    const watched = new Set<Element>();
    const watchStage = () => {
      for (const el of host.querySelectorAll(".stage, .stage-area")) {
        if (!watched.has(el)) {
          watched.add(el);
          ro.observe(el);
        }
      }
    };
    watchStage();
    // The stage mounts after this effect and slides when the side panel opens.
    const mo = new MutationObserver(() => {
      watchStage();
      schedule();
    });
    mo.observe(host, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
    host.addEventListener("transitionend", schedule);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      host.removeEventListener("transitionend", schedule);
    };
  }, [poster, lite]);

  return (
    <div className="ambient" aria-hidden="true">
      <canvas ref={canvasRef} className={`ambient-canvas${ready ? " ready" : ""}`} />
    </div>
  );
}

/** CSS `radial-gradient(rx ry at cx cy, ...)` drawn as an ellipse: a unit circle scaled per axis. */
function radial(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, rx: number, ry: number, stops: [number, string][]) {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  ctx.fillStyle = g;
  ctx.fillRect(-cx / rx, -cy / ry, w / rx, h / ry);
  ctx.restore();
}

/** Same layers and numbers as the former CSS: .hero base, .ambient-img and .ambient-shade. */
function paintBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, poster: HTMLCanvasElement | null) {
  // .hero: radial-gradient(120% 90% at 30% 20%, #5b3424 0%, #2c1913 55%, #160d0a 100%)
  // CSS sizes an explicit-size ellipse by its radii, so 120%/90% are the radii.
  radial(ctx, w, h, w * 0.3, h * 0.2, w * 1.2, h * 0.9, [
    [0, "#5b3424"],
    [0.55, "#2c1913"],
    [1, "#160d0a"],
  ]);
  if (poster) {
    // .ambient-img: inset -6%, background-size cover, opacity .9, bilinear upscale as the blur.
    const bw = w * 1.12;
    const bh = h * 1.12;
    const scale = Math.max(bw / poster.width, bh / poster.height);
    const dw = poster.width * scale;
    const dh = poster.height * scale;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(poster, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  // .ambient-shade: radial-gradient(90% 70% at 50% 40%, transparent, rgba(0,0,0,.3)) and a
  // linear rgba(28,16,12,.25) -> .45 wash on top.
  radial(ctx, w, h, w * 0.5, h * 0.4, w * 0.9, h * 0.7, [
    [0, "rgba(0,0,0,0)"],
    [1, "rgba(0,0,0,0.3)"],
  ]);
  const lin = ctx.createLinearGradient(0, 0, 0, h);
  lin.addColorStop(0, "rgba(28,16,12,0.25)");
  lin.addColorStop(1, "rgba(28,16,12,0.45)");
  ctx.fillStyle = lin;
  ctx.fillRect(0, 0, w, h);
}

/** CSS `box-shadow: 0 18px 50px -12px rgba(0,0,0,.65)` on a 14px-radius box. */
function paintStageShadow(ctx: CanvasRenderingContext2D, dpr: number, x: number, y: number, w: number, h: number) {
  const spread = -12;
  const far = 100000; // draw the shape off-canvas so only its shadow lands
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 50 * dpr;
  ctx.shadowOffsetX = far;
  ctx.shadowOffsetY = 18 * dpr;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect((x - spread - far / dpr) * dpr, (y - spread) * dpr, (w + spread * 2) * dpr, (h + spread * 2) * dpr, Math.max(0, 14 + spread) * dpr);
  ctx.fill();
  ctx.restore();
}

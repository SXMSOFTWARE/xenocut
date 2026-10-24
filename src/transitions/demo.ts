// Browser demos: one shared offscreen WebGL renderer draws every card (two film stills, the
// same shader code the preview and the export use) and the result is copied into the card's 2D
// canvas, so a hundred cards cost one GL context.
import aUrl from "../assets/trans-demo/a.webp";
import bUrl from "../assets/trans-demo/b.webp";
import { TransitionRenderer } from "./gl";

export const DEMO_W = 256;
export const DEMO_H = 144;

let renderer: TransitionRenderer | null = null;
let stills: Promise<[HTMLImageElement, HTMLImageElement] | null> | null = null;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = fail;
    img.src = url;
  });
}

/** The two demo stills (decoded once). */
export function demoStills() {
  stills ??= Promise.all([load(aUrl), load(bUrl)]).catch(() => null);
  return stills;
}

function shared(): TransitionRenderer {
  if (!renderer) {
    const c = document.createElement("canvas");
    c.width = DEMO_W;
    c.height = DEMO_H;
    renderer = new TransitionRenderer(c, true);
  }
  return renderer;
}

/** Draws one demo frame into `target`. False when WebGL or the shader is unavailable. */
export function drawDemo(
  target: HTMLCanvasElement,
  imgs: [HTMLImageElement, HTMLImageElement],
  glsl: string,
  builtin: boolean,
  progress: number,
  params?: Record<string, number | number[] | boolean>,
): boolean {
  const r = shared();
  if (!r.render({ glsl, builtin, params, from: imgs[0], to: imgs[1], progress })) return false;
  const ctx = target.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(r.canvas, 0, 0, target.width, target.height);
  return true;
}

/** Demo timeline: hold A, transition, hold B (seconds → progress). */
export function demoProgress(t: number, period = 1.8): number {
  const u = (t % period) / period;
  if (u < 0.15) return 0;
  if (u > 0.85) return 1;
  return (u - 0.15) / 0.7;
}

// Preview of a clip's native effect plug-ins (OpenFX / frei0r). The visible frame is copied to
// a scratch canvas, sent to the effect host and the answer drawn on a 2D canvas over the media
// element. One request is in flight at a time: while playing that gives a lower frame rate at a
// reduced size, paused frames come back at up to 1280 px. The export bakes the same chain at
// full size with the same parameters (fxbake.rs), so what you see is a scaled version of it.
import { enabledNative, renderNativeFrame, useNativeFx } from "../lib/nativefx";
import { log } from "../lib/backend";
import type { Clip } from "../project/types";

type Source = HTMLVideoElement | HTMLImageElement;

export interface NativeTarget {
  source: Source;
  clip: Clip;
  /** Source time of the frame on screen (clip-local, seconds). */
  time: number;
  playing: boolean;
  /** The clip fitted into the project canvas (what the export renders at). */
  full: { w: number; h: number };
  fps: number;
}

export class NativeFxView {
  private scratch = document.createElement("canvas");
  private busy = false;
  private wantKey = "";
  private shownKey = "";
  private shownClip = "";
  private pending: NativeTarget | null = null;
  private failures = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    /** Called when a processed frame landed, so the engine can show the canvas. */
    private onFrame: () => void,
  ) {}

  /** Show `target` through its plug-ins. Returns the canvas once it holds a frame of this clip. */
  update(target: NativeTarget | null, filter: string, opacity: string): HTMLCanvasElement | null {
    const chain = target ? enabledNative(target.clip) : [];
    const catalog = useNativeFx.getState().catalog;
    if (!target || !chain.length || (catalog && !catalog.available) || this.failures > 5) {
      this.hide();
      return null;
    }
    if (!catalog) void useNativeFx.getState().load();
    const src = target.source;
    const video = src instanceof HTMLVideoElement ? src : null;
    const sw = video ? video.videoWidth : (src as HTMLImageElement).naturalWidth;
    const sh = video ? video.videoHeight : (src as HTMLImageElement).naturalHeight;
    if (!sw || !sh || (video && video.readyState < 2)) return this.current(target);
    const frameKey = video ? Math.round(target.time * target.fps) : 0;
    const key = `${target.clip.id}|${JSON.stringify(chain)}|${frameKey}|${src.currentSrc}|${target.playing ? "p" : "s"}`;
    this.canvas.style.filter = filter;
    this.canvas.style.opacity = opacity;
    if (key !== this.wantKey) {
      this.wantKey = key;
      this.pending = target;
      this.pump(key);
    }
    return this.current(target);
  }

  private current(target: NativeTarget): HTMLCanvasElement | null {
    if (this.shownClip !== target.clip.id || !this.shownKey) {
      this.canvas.style.visibility = "hidden";
      return null;
    }
    this.canvas.style.visibility = "visible";
    return this.canvas;
  }

  private hide() {
    this.wantKey = "";
    this.pending = null;
    this.shownKey = "";
    this.shownClip = "";
    this.canvas.style.visibility = "hidden";
  }

  private pump(key: string) {
    const target = this.pending;
    if (this.busy || !target) return;
    this.pending = null;
    this.busy = true;
    const chain = enabledNative(target.clip);
    // Working size: the export size scaled down for speed.
    const cap = target.playing ? 480 : 1280;
    const s = Math.min(1, cap / Math.max(target.full.w, target.full.h));
    const w = Math.max(2, Math.round(target.full.w * s));
    const h = Math.max(2, Math.round(target.full.h * s));
    let rgba: Uint8ClampedArray;
    try {
      if (this.scratch.width !== w || this.scratch.height !== h) {
        this.scratch.width = w;
        this.scratch.height = h;
      }
      const ctx = this.scratch.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(target.source, 0, 0, w, h);
      rgba = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      // A tainted frame can't be read; the plain element stays visible.
      this.failures = 99;
      this.busy = false;
      log("warn", `native fx preview off: ${String(e)}`);
      return;
    }
    const req = { key: target.clip.id, chain, w, h, fullW: target.full.w, fullH: target.full.h, time: target.time, fps: target.fps };
    void renderNativeFrame(req, rgba)
      .then((out) => {
        if (out.length !== w * h * 4) throw new Error(`bad frame ${out.length}`);
        if (this.wantKey !== key && this.pending?.clip.id !== target.clip.id) return;
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
        this.canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
        const first = this.shownClip !== target.clip.id || !this.shownKey;
        this.shownKey = key;
        this.shownClip = target.clip.id;
        this.failures = 0;
        if (first || !target.playing) this.onFrame();
      })
      .catch((e) => {
        this.failures++;
        log("warn", `native fx preview: ${String(e)}`);
      })
      .finally(() => {
        this.busy = false;
        if (this.pending) this.pump(this.wantKey);
      });
  }

  dispose() {
    this.hide();
  }
}

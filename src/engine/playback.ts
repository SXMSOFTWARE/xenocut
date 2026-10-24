// Timeline preview. One <video>, one <img> and a small pool of <audio> elements are driven
// from a requestAnimationFrame clock. While a video clip plays, its element is the master
// clock (smooth A/V); in gaps or audio-only stretches the wall clock takes over.
import { useSettings } from "../store/settings";
import { useAssets } from "../store/assets";
import { fileSrc, log } from "../lib/backend";
import { clipDuration, clipEnd, projectDuration } from "../project/ops";
import type { Clip, MediaItem, Project, Track } from "../project/types";
import { usePlayback } from "../store/playback";
import { useProject } from "../store/project";
import { drawTexts, textStateKey } from "../text/render";
import { flashAt, motionAt, motionCss, previewFx, vignetteGradient } from "../project/effects";

const HARD_DRIFT = 0.3;
const PAUSED_EPS = 1 / 120;

interface Active {
  clip: Clip;
  media: MediaItem;
  track: Track;
}

function fadeGain(clip: Clip, t: number) {
  const local = t - clip.start;
  const dur = clipDuration(clip);
  let g = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) g = Math.min(g, local / clip.fadeIn);
  if (clip.fadeOut > 0 && local > dur - clip.fadeOut) g = Math.min(g, (dur - local) / clip.fadeOut);
  return Math.max(0, Math.min(1, g));
}

function sourceTime(clip: Clip, t: number) {
  return clip.in + (t - clip.start) * clip.speed;
}

const MEDIA_ERRORS = ["", "aborted", "network", "decode", "format not supported"];

function describeError(el: HTMLMediaElement | HTMLImageElement): string {
  const path = el.dataset.path ?? "";
  if (el instanceof HTMLImageElement) return `image failed to load: ${path}`;
  const err = el.error;
  const code = err?.code ?? 0;
  return `MediaError ${code} (${MEDIA_ERRORS[code] ?? "unknown"})${err?.message ? `: ${err.message}` : ""} — ${path}`;
}

function watch(el: HTMLMediaElement | HTMLImageElement) {
  if (el.dataset.watched) return;
  el.dataset.watched = "1";
  el.addEventListener("error", () => {
    if (!el.dataset.path) return; // src removed on purpose
    const message = describeError(el);
    log("error", `playback: ${message}`);
    usePlayback.setState({ mediaError: message });
  });
  const ok = () => {
    if (usePlayback.getState().mediaError) usePlayback.setState({ mediaError: null });
  };
  el.addEventListener(el instanceof HTMLImageElement ? "load" : "loadeddata", ok);
}

/** The file the preview should actually play: the 540p proxy when that option is on and it is ready. */
function previewPath(path: string): string {
  if (!useSettings.getState().previewProxy) return path;
  return useAssets.getState().proxies[path] ?? path;
}

/** Elements the per-clip effects preview drives (see project/effects.ts). */
export interface FxElements {
  /** Wrapper around the media and overlays: zoom / shake / flip transforms. */
  layer: HTMLElement;
  vignette: HTMLElement;
  grain: HTMLElement;
  /** White beat-hit flash over the fitted picture. */
  flash: HTMLElement;
  /** `<filter id="xc-fx-svg">`: sharpen and RGB split. */
  svg: SVGFilterElement;
}

function setStyle(el: HTMLElement, prop: "filter" | "transform" | "background" | "opacity" | "display", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

/** Fully opaque media gets no opacity at all, so WebKit never treats the frame as translucent. */
/** Automated test runs (XENOCUT_AUTOTEST) never make a sound. */
let silent = false;
export function setSilent(on: boolean) {
  silent = on;
}

function opacityCss(value: number): string {
  return value >= 0.999 ? "" : String(Math.max(0, value));
}

function setSrc(el: HTMLMediaElement | HTMLImageElement, path: string) {
  const src = fileSrc(path);
  if (el.dataset.path !== path) {
    el.dataset.path = path;
    el.src = src;
  }
}

class PlaybackEngine {
  private video: HTMLVideoElement | null = null;
  private image: HTMLImageElement | null = null;
  private audio = new Map<string, HTMLAudioElement>();
  private raf = 0;
  private lastPublish = 0;
  /** Test override for the store publish interval in ms (autotest `pubms=`). */
  publishMs: number | null = null;
  private latest = 0;
  private wallStart = 0;
  private timeStart = 0;
  private videoClipId: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private textCanvas: HTMLCanvasElement | null = null;
  private textKey = "";
  private textProject: Project | null = null;
  private fx: FxElements | null = null;
  private fxKey = "";
  private svgKey = "";

  attach(video: HTMLVideoElement, image: HTMLImageElement) {
    this.video = video;
    this.image = image;
    video.preload = "auto";
    video.playsInline = true;
    video.muted = false;
    watch(video);
    watch(image);
    this.unsubscribe?.();
    // Re-render the frame when the project changes while paused (trim, move, opacity...).
    this.unsubscribe = useProject.subscribe((s, prev) => {
      if (s.project !== prev.project && !usePlayback.getState().playing) this.render(usePlayback.getState().time, false);
    });
    this.render(usePlayback.getState().time, false);
  }

  /** The transparent canvas over the stage that shows text clips (drawn above the grade). */
  attachText(canvas: HTMLCanvasElement | null) {
    this.textCanvas = canvas;
    this.invalidateText();
  }

  attachFx(fx: FxElements | null) {
    this.fx = fx;
    this.fxKey = "";
    this.svgKey = "";
    this.render(this.latestTime(), usePlayback.getState().playing);
  }

  /** Effects of the visible clip: filter on the media element, overlays, layer transform. */
  private applyFx(p: Project, visual: Active | null, el: HTMLElement | null, t: number) {
    const fx = this.fx;
    if (!fx) return;
    const effects = visual?.clip.effects ?? [];
    if (!visual || !el || effects.length === 0) {
      if (this.fxKey !== "") {
        this.fxKey = "";
        for (const m of [this.video, this.image]) if (m) setStyle(m, "filter", "");
        setStyle(fx.layer, "transform", "");
        setStyle(fx.vignette, "display", "none");
        setStyle(fx.grain, "display", "none");
        setStyle(fx.flash, "display", "none");
      }
      return;
    }
    const stageH = fx.layer.clientHeight || p.settings.height;
    const look = previewFx(effects, p.settings.height, stageH / p.settings.height);
    const other = el === this.video ? this.image : this.video;
    if (other) setStyle(other, "filter", "");
    setStyle(el, "filter", look.filter);
    if (look.svg) {
      const key = `${look.svg.sharpen}|${look.svg.split}`;
      if (key !== this.svgKey) {
        this.svgKey = key;
        fx.svg.innerHTML = svgPrimitives(look.svg.sharpen, look.svg.split);
      }
    }
    // Overlays cover the fitted picture, like the export applies them before padding.
    const { width: W, height: H } = p.settings;
    const mw = visual.media.width || W;
    const mh = visual.media.height || H;
    const fit = Math.min(W / mw, H / mh);
    const rw = Math.min(1, (mw * fit) / W) * 100;
    const rh = Math.min(1, (mh * fit) / H) * 100;
    const rect = `${(100 - rw) / 2}%|${(100 - rh) / 2}%|${rw}%|${rh}%`;
    const key = `${visual.clip.id}|${rect}|${look.vignette}|${look.grain}`;
    if (key !== this.fxKey) {
      this.fxKey = key;
      for (const o of [fx.vignette, fx.grain, fx.flash]) {
        o.style.left = `${(100 - rw) / 2}%`;
        o.style.top = `${(100 - rh) / 2}%`;
        o.style.width = `${rw}%`;
        o.style.height = `${rh}%`;
      }
      setStyle(fx.vignette, "display", look.vignette > 0 ? "block" : "none");
      setStyle(fx.vignette, "background", look.vignette > 0 ? vignetteGradient(look.vignette) : "");
      setStyle(fx.grain, "display", look.grain > 0 ? "block" : "none");
      setStyle(fx.grain, "opacity", String(Math.min(1, look.grain * 0.7)));
    }
    if (look.grain > 0) {
      // A new noise offset every frame, stable for a given frame.
      const frame = Math.floor(t * p.settings.fps);
      const x = (frame * 73) % 199;
      const y = (frame * 151) % 197;
      fx.grain.style.backgroundPosition = `${x}px ${y}px`;
    }
    const local = t - visual.clip.start;
    const flash = flashAt(effects, local);
    setStyle(fx.flash, "display", flash > 0 ? "block" : "none");
    if (flash > 0) setStyle(fx.flash, "opacity", flash.toFixed(3));
    setStyle(fx.layer, "transform", motionCss(motionAt(effects, local, clipDuration(visual.clip))));
  }

  /** Force the next render to redraw text (canvas resized, fonts loaded). */
  invalidateText() {
    this.textProject = null;
    this.drawTextAt(this.latestTime());
  }

  private latestTime() {
    return usePlayback.getState().playing ? this.latest : usePlayback.getState().time;
  }

  private drawTextAt(t: number) {
    const canvas = this.textCanvas;
    const p = this.project();
    if (!canvas || !p) return;
    const frame = Math.floor(t * p.settings.fps + 1e-6);
    const key = textStateKey(p, t, frame);
    if (p === this.textProject && key === this.textKey) return;
    const hadText = this.textKey !== "" || this.textProject === null;
    this.textProject = p;
    this.textKey = key;
    if (!key && !hadText) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!key) return;
    ctx.setTransform(canvas.width / p.settings.width, 0, 0, canvas.height / p.settings.height, 0, 0);
    drawTexts(ctx, p, t, p.settings.width, p.settings.height);
  }

  detach() {
    this.pause();
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const el of this.audio.values()) {
      el.pause();
      delete el.dataset.path;
      el.removeAttribute("src");
      el.load();
    }
    this.audio.clear();
    this.video = null;
    this.image = null;
    this.videoClipId = null;
    this.textCanvas = null;
  }

  private project(): Project | null {
    return useProject.getState().project;
  }

  duration() {
    const p = this.project();
    return p ? projectDuration(p) : 0;
  }

  play() {
    const duration = this.duration();
    if (duration <= 0) return;
    let time = usePlayback.getState().time;
    if (time >= duration - 0.01) time = 0;
    this.wallStart = performance.now();
    this.timeStart = time;
    this.latest = time;
    usePlayback.setState({ playing: true, time });
    this.render(time, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    if (!usePlayback.getState().playing) return;
    usePlayback.setState({ playing: false, time: this.latest });
    this.video?.pause();
    for (const el of this.audio.values()) el.pause();
  }

  toggle() {
    if (usePlayback.getState().playing) this.pause();
    else this.play();
  }

  seek(time: number) {
    const t = Math.max(0, Math.min(this.duration(), time));
    this.wallStart = performance.now();
    this.timeStart = t;
    usePlayback.setState({ time: t });
    this.render(t, usePlayback.getState().playing);
  }

  step(frames: number) {
    const fps = this.project()?.settings.fps ?? 30;
    this.pause();
    this.seek(usePlayback.getState().time + frames / fps);
  }

  private tick = () => {
    const duration = this.duration();
    let time = this.timeStart + (performance.now() - this.wallStart) / 1000;

    // Follow the decoder while a video clip is actively playing.
    const p = this.project();
    const v = this.video;
    if (p && v && this.videoClipId && !v.paused && !v.seeking && v.readyState >= 3) {
      const clip = p.clips.find((c) => c.id === this.videoClipId);
      if (clip) {
        const fromVideo = clip.start + (v.currentTime - clip.in) / clip.speed;
        if (Math.abs(fromVideo - time) < HARD_DRIFT && fromVideo >= clip.start && fromVideo < clipEnd(clip)) {
          time = fromVideo;
          this.wallStart = performance.now();
          this.timeStart = time;
        }
      }
    }

    if (time >= duration) {
      usePlayback.setState({ time: duration });
      this.pause();
      this.render(duration, false);
      return;
    }
    // Performance mode moves the playhead, scrubber and timecode ~12 times a second instead of
    // every frame, so WebKit repaints the timeline far less often while the video plays.
    this.latest = time;
    const now = performance.now();
    const every = this.publishMs ?? (useSettings.getState().performanceMode ? 80 : 0);
    if (now - this.lastPublish >= every) {
      this.lastPublish = now;
      usePlayback.setState({ time });
    }
    this.render(time, true);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Bring every element in line with timeline time `t`. */
  render(t: number, playing: boolean) {
    const p = this.project();
    const video = this.video;
    const image = this.image;
    if (!p || !video || !image) return;
    this.drawTextAt(t);

    const mediaById = new Map(p.media.map((m) => [m.id, m]));
    const at = (track: Track): Active | null => {
      for (const clip of p.clips) {
        if (clip.trackId !== track.id) continue;
        if (t < clip.start - 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
        const media = mediaById.get(clip.mediaId);
        if (media) return { clip, media, track };
      }
      return null;
    };

    // Visual: the first (top-most) visible video track with a clip under the playhead.
    let visual: Active | null = null;
    for (const track of p.tracks) {
      if (track.kind !== "video" || track.hidden) continue;
      visual = at(track);
      if (visual) break;
    }

    const fxEl = !visual ? null : visual.media.kind === "image" ? image : video;
    this.applyFx(p, visual, fxEl, t);

    if (!visual) {
      this.videoClipId = null;
      video.style.visibility = "hidden";
      image.style.visibility = "hidden";
      if (!video.paused) video.pause();
    } else if (visual.media.kind === "image") {
      this.videoClipId = null;
      if (!video.paused) video.pause();
      video.style.visibility = "hidden";
      setSrc(image, visual.media.path);
      image.style.visibility = "visible";
      image.style.opacity = opacityCss(visual.clip.opacity * fadeGain(visual.clip, t));
    } else {
      image.style.visibility = "hidden";
      setSrc(video, previewPath(visual.media.path));
      video.style.visibility = "visible";
      video.style.opacity = opacityCss(visual.clip.opacity * fadeGain(visual.clip, t));
      const muted = silent || visual.track.muted || !visual.media.hasAudio;
      video.muted = muted;
      video.volume = Math.min(1, visual.clip.volume * fadeGain(visual.clip, t));
      this.syncElement(video, visual.clip, t, playing, this.videoClipId !== visual.clip.id);
      this.videoClipId = visual.clip.id;
    }

    // Audio: every unmuted audio/music track clip under the playhead.
    const wanted = new Set<string>();
    for (const track of p.tracks) {
      if (track.kind === "video" || track.kind === "text" || track.muted) continue;
      const active = at(track);
      if (!active) continue;
      wanted.add(active.clip.id);
      let el = this.audio.get(active.clip.id);
      if (!el) {
        el = new Audio();
        el.preload = "auto";
        watch(el);
        this.audio.set(active.clip.id, el);
      }
      setSrc(el, active.media.path);
      el.volume = silent ? 0 : Math.min(1, active.clip.volume * fadeGain(active.clip, t));
      this.syncElement(el, active.clip, t, playing, false);
    }
    for (const [id, el] of this.audio) {
      if (wanted.has(id)) continue;
      el.pause();
      delete el.dataset.path;
      el.removeAttribute("src");
      el.load();
      this.audio.delete(id);
    }
  }

  private syncElement(el: HTMLMediaElement, clip: Clip, t: number, playing: boolean, entering: boolean) {
    const target = sourceTime(clip, t);
    if (Math.abs(el.playbackRate - clip.speed) > 1e-3) el.playbackRate = clip.speed;
    if (playing) {
      if (entering || el.paused || Math.abs(el.currentTime - target) > HARD_DRIFT) {
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
      }
      if (el.paused && !el.error) {
        void el.play().catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          log("warn", `play() rejected: ${String(error)} — ${el.dataset.path ?? ""}`);
        });
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - target) > PAUSED_EPS) el.currentTime = target;
    }
  }
}

/** SVG primitives for sharpen (3x3 unsharp approximation) and RGB split (`split` CSS px). */
function svgPrimitives(sharpen: number, split: number): string {
  const parts: string[] = [];
  let src = "SourceGraphic";
  if (sharpen > 0) {
    const k = (sharpen * 0.5).toFixed(3);
    const c = (1 + 4 * sharpen * 0.5).toFixed(3);
    parts.push(`<feConvolveMatrix in="${src}" order="3" kernelMatrix="0 -${k} 0 -${k} ${c} -${k} 0 -${k} 0" divisor="1" edgeMode="duplicate" preserveAlpha="true" result="sharp"/>`);
    src = "sharp";
  }
  if (split > 0) {
    parts.push(
      `<feColorMatrix in="${src}" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>`,
      `<feOffset in="r" dx="${-split}" dy="0" result="r2"/>`,
      `<feColorMatrix in="${src}" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>`,
      `<feColorMatrix in="${src}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>`,
      `<feOffset in="b" dx="${split}" dy="0" result="b2"/>`,
      `<feBlend in="r2" in2="g" mode="screen" result="rg"/>`,
      `<feBlend in="rg" in2="b2" mode="screen"/>`,
    );
  }
  return parts.join("");
}

export const engine = new PlaybackEngine();

// Timeline preview. One <video>, one <img> and a small pool of <audio> elements are driven
// from a requestAnimationFrame clock. While a video clip plays, its element is the master
// clock (smooth A/V); in gaps or audio-only stretches the wall clock takes over.
import { onLottieReady } from "../lottie/render";
import { useSettings } from "../store/settings";
import { useAssets } from "../store/assets";
import { needsDecodeProxy } from "../lib/playable";
import { LutView } from "./lutview";
import { fileSrc, log, transport } from "../lib/backend";
import { clipDuration, clipEnd, projectDuration } from "../project/ops";
import type { Clip, MediaItem, Project, Track } from "../project/types";
import { usePlayback } from "../store/playback";
import { useProject } from "../store/project";
import { drawTexts, textStateKey } from "../text/render";
import { animAt, animCss, animEffects } from "../project/anims";
import { TransitionRenderer } from "../transitions/gl";
import { joinAt, joins, transitionGlsl, type Join } from "../transitions/index";
import { fxAt, letterboxBackground, motionCss, scanlineBackground, vignetteGradient, type FxState } from "../project/effects";

/** How often playback pushes the time to the store (and so to the playhead painters). */
const PUBLISH_MS = 80;

const HARD_DRIFT = 0.3;
/** How early the incoming clip of a transition starts loading in the spare element. */
const PREROLL = 1.5;
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

/** Opacity from the clip's In / Out animations (picture only; audio ignores it). */
function animAlpha(clip: Clip, t: number) {
  return clip.anim ? animAt(clip.anim, t - clip.start, clipDuration(clip)).alpha : 1;
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
    if (!(el instanceof HTMLImageElement) && convertUndecodable(el.dataset.path, el.error?.code ?? 0, message)) return;
    usePlayback.setState({ mediaError: message, mediaConverting: null });
  });
  const ok = () => {
    const s = usePlayback.getState();
    if (s.mediaError || s.mediaConverting) usePlayback.setState({ mediaError: null, mediaConverting: null });
  };
  el.addEventListener(el instanceof HTMLImageElement ? "load" : "loadeddata", ok);
}

/**
 * "Format not supported" / "decode" errors on an original file: build a preview copy this web view
 * can decode (WebM where H.264 is missing) and swap to it, instead of leaving a dead preview.
 * Returns false when there is nothing to convert (the failing file already is a proxy).
 */
function convertUndecodable(playing: string, code: number, message: string): boolean {
  if (code !== 3 && code !== 4) return false;
  const assets = useAssets.getState();
  if (Object.values(assets.proxies).includes(playing)) return false;
  const media = useProject.getState().project?.media.find((m) => m.path === playing);
  if (!media) return false;
  usePlayback.setState({ mediaError: null, mediaConverting: media.name });
  void assets.requestProxy(media, true).then((proxy) => {
    if (usePlayback.getState().mediaConverting !== media.name) return;
    if (proxy) {
      log("info", `playback: using preview copy ${proxy} for ${playing}`);
      usePlayback.setState({ mediaConverting: null });
      engine.seek(usePlayback.getState().time);
    } else {
      const why = useAssets.getState().failed[playing] ?? "";
      usePlayback.setState({ mediaConverting: null, mediaError: `${message}${why ? ` · proxy: ${why.slice(0, 200)}` : ""}` });
    }
  });
  return true;
}

/** The file the preview should actually play: the 540p proxy when that option is on and it is ready. */
function previewPath(path: string): string {
  const assets = useAssets.getState();
  if (!useSettings.getState().previewProxy && !assets.forced[path]) return path;
  const proxy = assets.proxies[path];
  // An older MP4 proxy is no use where H.264 cannot be decoded; wait for the WebM one.
  if (proxy && assets.forced[path] && needsDecodeProxy() && !proxy.endsWith(".webm")) return path;
  return proxy ?? path;
}

/** Elements the per-clip effects preview drives (see project/effects.ts). */
/** Overlays drawn over a picture (a clip's fitted picture or an effect layer's whole canvas). */
export interface FxOverlays {
  /** Positioned box holding the overlays (each fills it). */
  box: HTMLElement;
  vignette: HTMLElement;
  grain: HTMLElement;
  scanlines: HTMLElement;
  /** White beat-hit flash. */
  flash: HTMLElement;
  /** Black dip (fade in / fade out effects). */
  dip: HTMLElement;
  letterbox: HTMLElement;
}

export interface FxElements {
  /** Effect layers: zoom / shake transform around everything below. */
  layer: HTMLElement;
  /** Effect layers: colour / blur filter on the clips (not on the layer overlays). */
  layerPicture: HTMLElement;
  /** The visible clip: zoom / shake / flips transform around its media and overlays. */
  clip: HTMLElement;
  clipOverlays: FxOverlays;
  layerOverlays: FxOverlays;
  /** `<filter id="xc-fx-svg">` (clip) and `xc-fx-svg2` (layers): sharpen and RGB split. */
  svg: SVGFilterElement;
  svg2: SVGFilterElement;
}

function ready(el: HTMLVideoElement | HTMLImageElement): boolean {
  return el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : el.readyState >= 2 && !el.seeking;
}

function sizeOf(el: HTMLVideoElement | HTMLImageElement): [number, number] | undefined {
  const w = el instanceof HTMLImageElement ? el.naturalWidth : el.videoWidth;
  const h = el instanceof HTMLImageElement ? el.naturalHeight : el.videoHeight;
  return w > 0 && h > 0 ? [w, h] : undefined;
}

function setStyle(el: HTMLElement, prop: "filter" | "transform" | "background" | "opacity" | "display" | "left" | "top" | "width" | "height", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

/** Fully opaque media gets no opacity at all, so WebKit never treats the frame as translucent. */
/** Automated test runs (XENOCUT_AUTOTEST) never make a sound. Normal runs can never be silenced: without the
 *  env var this refuses and logs, so preview audio always plays at the clip's volume. */
let silent = false;
export function setSilent(on: boolean) {
  if (on && !transport.autotest) {
    log("warn", "playback: setSilent refused, not an autotest run");
    return;
  }
  silent = on;
}
/** Test hook: whether the preview is currently forced silent (always false outside autotest runs). */
export function isSilent(): boolean {
  return silent;
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
  private svgKey = "";
  private svg2Key = "";
  private lutView: LutView | null = null;
  /** Second video element: the other side of a transition (and the next clip, prerolled). */
  private spare: HTMLVideoElement | null = null;
  /** Off-DOM image for an image clip on the other side of a transition. */
  private spareImage: HTMLImageElement | null = null;
  private trCanvas: HTMLCanvasElement | null = null;
  private tr: TransitionRenderer | null = null;
  private joinCache: { clips: Clip[]; tracks: Track[]; joins: Map<string, Join> } | null = null;

  attach(video: HTMLVideoElement, image: HTMLImageElement) {
    this.video = video;
    this.image = image;
    // The LUT preview reads frames into WebGL, which needs CORS-clean media from the loopback
    // server (it answers with Access-Control-Allow-Origin: *). Must be set before any src.
    if (transport.base) {
      video.crossOrigin = "anonymous";
      image.crossOrigin = "anonymous";
    }
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

  /** The spare video and the WebGL canvas transitions are drawn on (null detaches). */
  attachTransition(video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null) {
    this.tr?.dispose();
    this.tr = canvas ? new TransitionRenderer(canvas) : null;
    this.trCanvas = canvas;
    this.spare = video;
    if (video) {
      if (transport.base) video.crossOrigin = "anonymous";
      video.preload = "auto";
      video.playsInline = true;
      video.muted = true;
      video.style.visibility = "hidden";
      watch(video);
    }
    if (!this.spareImage) {
      this.spareImage = new Image();
      if (transport.base) this.spareImage.crossOrigin = "anonymous";
      this.spareImage.addEventListener("load", this.redrawPaused);
    }
    // A paused frame inside a transition window needs both sides decoded: redraw when they are.
    for (const el of [video, this.video]) {
      if (!el || el.dataset.trWatched) continue;
      el.dataset.trWatched = "1";
      el.addEventListener("seeked", this.redrawPaused);
      el.addEventListener("loadeddata", this.redrawPaused);
    }
    this.render(this.latestTime(), usePlayback.getState().playing);
  }

  private redrawPaused = () => {
    if (!usePlayback.getState().playing && this.trCanvas) this.render(usePlayback.getState().time, false);
  };

  private joinsOf(p: Project): Map<string, Join> {
    const c = this.joinCache;
    if (c && c.clips === p.clips && c.tracks === p.tracks) return c.joins;
    const map = joins(p.clips, p.tracks);
    this.joinCache = { clips: p.clips, tracks: p.tracks, joins: map };
    return map;
  }

  /** Puts `clip` at time t into the spare element (paused outside its media, like a held frame). */
  private syncSpare(el: HTMLVideoElement, clip: Clip, media: MediaItem, t: number, playing: boolean) {
    setSrc(el, previewPath(media.path));
    el.dataset.clip = clip.id;
    el.muted = true;
    const target = sourceTime(clip, t);
    const end = Math.max(0, (media.duration || Infinity) - 0.04);
    if (playing && target >= 0 && target < end) {
      this.syncElement(el, clip, t, true, false);
    } else {
      if (!el.paused) el.pause();
      const held = Math.min(Math.max(target, 0), end);
      if (Math.abs(el.currentTime - held) > PAUSED_EPS) el.currentTime = held;
    }
  }

  /** Draws the transition under the playhead. False when there is none or it can't be drawn yet. */
  private renderTransition(p: Project, visual: Active, mediaById: Map<string, MediaItem>, t: number, playing: boolean): boolean {
    const canvas = this.trCanvas;
    const tr = this.tr;
    if (!canvas || !tr) return false;
    const all = this.joinsOf(p);
    if (all.size === 0) return false;
    const join = joinAt(all, visual.track.id, t);
    if (!join) {
      // Preroll the incoming clip a little before its transition starts.
      const next = all.get(visual.clip.id);
      const spare = this.spare;
      const media = next && mediaById.get(next.to.mediaId);
      if (next && spare && media && media.kind !== "image" && t >= next.cut - next.duration / 2 - PREROLL) {
        this.syncSpare(spare, next.to, media, next.cut - next.duration / 2, false);
      }
      return false;
    }
    const isFrom = visual.clip.id === join.from.id;
    const otherClip = isFrom ? join.to : join.from;
    const otherMedia = mediaById.get(otherClip.mediaId);
    if (!otherMedia) return false;
    let other: HTMLVideoElement | HTMLImageElement | null;
    if (otherMedia.kind === "image") {
      other = this.spareImage;
      if (other) setSrc(other, otherMedia.path);
    } else {
      other = this.spare;
      if (other) this.syncSpare(other, otherClip, otherMedia, t, playing);
    }
    const main = visual.media.kind === "image" ? this.image : this.video;
    if (!other || !main || !ready(other) || !ready(main)) return false;
    const shader = transitionGlsl(join.transition);
    if (!shader) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, useSettings.getState().performanceMode ? 1 : 2);
    const w = Math.max(16, Math.min(p.settings.width, Math.round(canvas.clientWidth * dpr)));
    const h = Math.max(16, Math.round((w * p.settings.height) / p.settings.width));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const [from, to] = isFrom ? [main, other] : [other, main];
    const progress = (t - (join.cut - join.duration / 2)) / join.duration;
    return tr.render({ ...shader, params: join.transition.params, from, to, fromSize: sizeOf(from), toSize: sizeOf(to), progress });
  }

  /** The transparent canvas over the stage that shows text clips (drawn above the grade). */
  attachText(canvas: HTMLCanvasElement | null) {
    this.textCanvas = canvas;
    this.lottieOff?.();
    this.lottieOff = canvas ? onLottieReady(() => this.invalidateText()) : null;
    this.invalidateText();
  }
  private lottieOff: (() => void) | null = null;

  /** The WebGL canvas that shows the visible clip through its LUT (null detaches). */
  attachLut(canvas: HTMLCanvasElement | null) {
    this.lutView?.dispose();
    this.lutView = canvas ? new LutView(canvas, () => this.render(this.latestTime(), usePlayback.getState().playing)) : null;
    this.render(this.latestTime(), usePlayback.getState().playing);
  }

  attachFx(fx: FxElements | null) {
    this.fx = fx;
    this.svgKey = "";
    this.svg2Key = "";
    this.render(this.latestTime(), usePlayback.getState().playing);
  }

  /** Effects of the visible clip (filter on the media element, overlays over its fitted picture,
   *  transform) and of the effect layers above it (on everything composited so far). */
  private applyFx(p: Project, visual: Active | null, el: HTMLElement | null, t: number, plain = false) {
    const fx = this.fx;
    if (!fx) return;
    const stageH = fx.layer.clientHeight || p.settings.height;
    const scale = stageH / p.settings.height;
    const H = p.settings.height;

    // The clip.
    const dur = visual ? clipDuration(visual.clip) : 0;
    // `plain`: a transition is drawn instead of the clip (its own effects are not previewed).
    const anim = plain ? undefined : visual?.clip.anim;
    const effects = plain ? [] : [...(visual?.clip.effects ?? []), ...animEffects(anim, dur)];
    const animTransform = visual && anim ? animCss(animAt(anim, t - visual.clip.start, dur)) : "";
    const other = el === this.video ? this.image : this.video;
    if (other) setStyle(other, "filter", "");
    if (!visual || !el || effects.length === 0) {
      if (el) setStyle(el, "filter", "");
      setStyle(fx.clip, "transform", animTransform);
      this.paintOverlays(fx.clipOverlays, null, t, p, scale);
    } else {
      const local = t - visual.clip.start;
      const look = fxAt(effects, local, dur, H, scale, "xc-fx-svg");
      setStyle(el, "filter", look.filter);
      if (look.svg) {
        const key = `${look.svg.sharpen}|${look.svg.split}`;
        if (key !== this.svgKey) {
          this.svgKey = key;
          fx.svg.innerHTML = svgPrimitives(look.svg.sharpen, look.svg.split);
        }
      }
      // Overlays cover the fitted picture, like the export applies them before padding.
      const { width: W } = p.settings;
      const mw = visual.media.width || W;
      const mh = visual.media.height || H;
      const fit = Math.min(W / mw, H / mh);
      const rw = Math.min(1, (mw * fit) / W) * 100;
      const rh = Math.min(1, (mh * fit) / H) * 100;
      const box = fx.clipOverlays.box;
      setStyle(box, "left", `${(100 - rw) / 2}%`);
      setStyle(box, "top", `${(100 - rh) / 2}%`);
      setStyle(box, "width", `${rw}%`);
      setStyle(box, "height", `${rh}%`);
      this.paintOverlays(fx.clipOverlays, look, t, p, scale);
      setStyle(fx.clip, "transform", [animTransform, motionCss(look.motion)].filter(Boolean).join(" "));
    }

    // Effect layers on tracks above the visible clip (all of them over a gap).
    const below = visual ? p.tracks.indexOf(visual.track) : p.tracks.length;
    const looks: FxState[] = [];
    for (let i = below - 1; i >= 0; i--) {
      const track = p.tracks[i];
      if (track.kind !== "effect" || track.hidden) continue;
      for (const c of p.clips) {
        if (c.trackId !== track.id || !c.effects?.length) continue;
        if (t < c.start - 1e-6 || t >= clipEnd(c) - 1e-6) continue;
        looks.push(fxAt(c.effects, t - c.start, clipDuration(c), H, scale, "xc-fx-svg2"));
      }
    }
    const merged = mergeLooks(looks);
    setStyle(fx.layerPicture, "filter", merged?.filter ?? "");
    if (merged?.svg) {
      const key = `${merged.svg.sharpen}|${merged.svg.split}`;
      if (key !== this.svg2Key) {
        this.svg2Key = key;
        fx.svg2.innerHTML = svgPrimitives(merged.svg.sharpen, merged.svg.split);
      }
    }
    this.paintOverlays(fx.layerOverlays, merged, t, p, scale);
    setStyle(fx.layer, "transform", looks.map((l) => motionCss(l.motion)).filter(Boolean).join(" "));
  }

  private paintOverlays(o: FxOverlays, look: FxState | null, t: number, p: Project, scale: number) {
    const show = (e: HTMLElement, on: boolean) => setStyle(e, "display", on ? "block" : "none");
    show(o.vignette, !!look && look.vignette > 0);
    show(o.grain, !!look && look.grain > 0);
    show(o.scanlines, !!look && look.scanlines > 0);
    show(o.flash, !!look && look.flash > 0);
    show(o.dip, !!look && look.dip > 0);
    show(o.letterbox, !!look && look.letterbox > 0);
    if (!look) return;
    if (look.vignette > 0) setStyle(o.vignette, "background", vignetteGradient(look.vignette));
    if (look.grain > 0) {
      setStyle(o.grain, "opacity", String(Math.min(1, look.grain * 0.7)));
      // A new noise offset every frame, stable for a given frame.
      const frame = Math.floor(t * p.settings.fps);
      o.grain.style.backgroundPosition = `${(frame * 73) % 199}px ${(frame * 151) % 197}px`;
    }
    if (look.scanlines > 0) setStyle(o.scanlines, "background", scanlineBackground(look.scanlines, p.settings.height, scale));
    if (look.flash > 0) setStyle(o.flash, "opacity", look.flash.toFixed(3));
    if (look.dip > 0) setStyle(o.dip, "opacity", look.dip.toFixed(3));
    if (look.letterbox > 0) setStyle(o.letterbox, "background", letterboxBackground(look.letterbox));
  }

  /** Force the next render to redraw text (canvas resized, fonts loaded). */
  invalidateText() {
    this.textProject = null;
    this.drawTextAt(this.latestTime());
  }

  /** The exact playback time: the running clock while playing (the store lags up to PUBLISH_MS). */
  now() {
    return this.latestTime();
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
    if (this.spare) {
      this.spare.pause();
      delete this.spare.dataset.clip;
    }
    this.attachTransition(null, null);
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
    this.spare?.pause();
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
    // The playhead, scrubber and timecode move ~12 times a second while playing, not every frame.
    // Measured on WebKitGTK (1080p60, Ryzen laptop): any DOM change outside the video, even a
    // single transform, makes the frame repaint far more than the video rect, which halved the
    // decoded frames (255/480 at 60 Hz updates vs 467/480 at 12.5 Hz). Seeks still publish at once.
    this.latest = time;
    const now = performance.now();
    const every = this.publishMs ?? PUBLISH_MS;
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
    let video = this.video;
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

    // The clip may already be loaded in the spare element (prerolled, or the incoming side of a
    // transition): swap roles instead of reloading, so the cut has no gap.
    const spare = this.spare;
    if (visual && visual.media.kind !== "image" && spare && video.dataset.clip !== visual.clip.id && spare.dataset.clip === visual.clip.id && spare.dataset.path === previewPath(visual.media.path)) {
      this.spare = video;
      this.video = spare;
      video.muted = true;
      video.style.visibility = "hidden";
      setStyle(video, "filter", "");
      video = spare;
      this.videoClipId = visual.clip.id;
    }

    const fxEl = !visual ? null : visual.media.kind === "image" ? image : video;
    this.applyFx(p, visual, fxEl, t);

    if (!visual) {
      this.lutView?.update(null, undefined, "", "");
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
      const op = opacityCss(visual.clip.opacity * fadeGain(visual.clip, t) * animAlpha(visual.clip, t));
      const lut = this.lutView?.update(image, visual.clip.lut, image.style.filter, op) ?? false;
      setStyle(image, "opacity", lut ? "0" : op);
    } else {
      image.style.visibility = "hidden";
      setSrc(video, previewPath(visual.media.path));
      video.style.visibility = "visible";
      const op = opacityCss(visual.clip.opacity * fadeGain(visual.clip, t) * animAlpha(visual.clip, t));
      const lut = this.lutView?.update(video, visual.clip.lut, video.style.filter, op) ?? false;
      setStyle(video, "opacity", lut ? "0" : op);
      const muted = silent || visual.track.muted || !visual.media.hasAudio;
      video.muted = muted;
      video.volume = Math.min(1, visual.clip.volume * fadeGain(visual.clip, t));
      this.syncElement(video, visual.clip, t, playing, this.videoClipId !== visual.clip.id);
      this.videoClipId = visual.clip.id;
      video.dataset.clip = visual.clip.id;
    }

    // Transition window: the WebGL canvas shows both sides instead of the clip.
    const showTr = !!visual && this.renderTransition(p, visual, mediaById, t, playing);
    if (this.trCanvas) setStyle(this.trCanvas, "display", showTr ? "block" : "none");
    if (showTr) {
      this.applyFx(p, visual, fxEl, t, true);
      this.lutView?.update(null, undefined, "", "");
      if (fxEl) setStyle(fxEl, "opacity", "0");
    } else if (this.spare && this.spare.dataset.clip && !this.spare.paused && !this.prerolling(p, visual, t)) {
      this.spare.pause();
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

  private prerolling(p: Project, visual: Active | null, t: number): boolean {
    const next = visual && this.joinsOf(p).get(visual.clip.id);
    return !!next && t >= next.cut - next.duration / 2 - PREROLL;
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
/** Several effect layers active at once (preview only; the export chains them exactly):
 *  filters chain bottom first, overlays take the strongest, flashes / dips combine. */
function mergeLooks(looks: FxState[]): FxState | null {
  if (looks.length === 0) return null;
  if (looks.length === 1) return looks[0];
  const max = (k: "vignette" | "grain" | "scanlines" | "letterbox") => Math.max(...looks.map((l) => l[k]));
  const keep = (k: "flash" | "dip") => looks.reduce((v, l) => v * (1 - l[k]), 1);
  return {
    filter: looks.map((l) => l.filter).filter(Boolean).join(" "),
    svg: looks.find((l) => l.svg)?.svg ?? null,
    vignette: max("vignette"),
    grain: max("grain"),
    scanlines: max("scanlines"),
    letterbox: max("letterbox"),
    flash: 1 - keep("flash"),
    dip: 1 - keep("dip"),
    motion: null,
  };
}

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

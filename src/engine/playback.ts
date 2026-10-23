// Timeline preview. One <video>, one <img> and a small pool of <audio> elements are driven
// from a requestAnimationFrame clock. While a video clip plays, its element is the master
// clock (smooth A/V); in gaps or audio-only stretches the wall clock takes over.
import { fileSrc, log } from "../lib/backend";
import { clipDuration, clipEnd, projectDuration } from "../project/ops";
import type { Clip, MediaItem, Project, Track } from "../project/types";
import { usePlayback } from "../store/playback";
import { useProject } from "../store/project";

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
  private wallStart = 0;
  private timeStart = 0;
  private videoClipId: string | null = null;
  private unsubscribe: (() => void) | null = null;

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
    usePlayback.setState({ playing: true, time });
    this.render(time, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.raf);
    if (!usePlayback.getState().playing) return;
    usePlayback.setState({ playing: false });
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
    usePlayback.setState({ time });
    this.render(time, true);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Bring every element in line with timeline time `t`. */
  render(t: number, playing: boolean) {
    const p = this.project();
    const video = this.video;
    const image = this.image;
    if (!p || !video || !image) return;

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
      image.style.opacity = String(visual.clip.opacity * fadeGain(visual.clip, t));
    } else {
      image.style.visibility = "hidden";
      setSrc(video, visual.media.path);
      video.style.visibility = "visible";
      video.style.opacity = String(visual.clip.opacity * fadeGain(visual.clip, t));
      const muted = visual.track.muted || !visual.media.hasAudio;
      video.muted = muted;
      video.volume = Math.min(1, visual.clip.volume * fadeGain(visual.clip, t));
      this.syncElement(video, visual.clip, t, playing, this.videoClipId !== visual.clip.id);
      this.videoClipId = visual.clip.id;
    }

    // Audio: every unmuted audio/music track clip under the playhead.
    const wanted = new Set<string>();
    for (const track of p.tracks) {
      if (track.kind === "video" || track.muted) continue;
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
      el.volume = Math.min(1, active.clip.volume * fadeGain(active.clip, t));
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

export const engine = new PlaybackEngine();

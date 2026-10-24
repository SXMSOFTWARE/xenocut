// Draws text clips on a 2D canvas. The live preview and the export share this code, so the
// rendered video matches the preview frame for frame.
import { drawLottie, lottieBox, lottieHit, lottieFrameKey, lottieVersion } from "../lottie/render";
import type { Clip, Project } from "../project/types";
import { clipDuration, clipEnd } from "../project/ops";
import type { AnimIn, AnimOut, TextContent, TextStyle } from "../project/text";
import { fontSpec, fontWeight } from "./fonts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Word {
  text: string;
  x: number; // left edge relative to the block's left
  w: number;
  /** Index of the first character in the whole text (karaoke, typewriter). */
  char: number;
  index: number;
}

interface Line {
  words: Word[];
  w: number;
  y: number; // centre, relative to block top
}

export interface TextLayout {
  font: string;
  px: number;
  spacing: number;
  lines: Line[];
  /** Block size and top-left corner on the canvas (without animation). */
  w: number;
  h: number;
  left: number;
  top: number;
  chars: number;
  words: number;
  space: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const backOut = (p: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2;
};

export function unitFor(width: number, height: number) {
  return Math.min(width, height) / 1080;
}

export function fontCss(style: TextStyle, px: number): string {
  const spec = fontSpec(style.font);
  const italic = style.italic && spec.italic ? "italic " : "";
  return `${italic}${fontWeight(spec, style.weight)} ${px.toFixed(2)}px "${spec.family}", "Inter", sans-serif`;
}

function setSpacing(ctx: Ctx, value: number) {
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${value.toFixed(2)}px`;
}

export function displayText(text: TextContent): string {
  if (!text.style.uppercase) return text.content;
  // Casing follows the text's language (else the UI's) so Turkish "i" becomes "İ" and English stays "I".
  const lang = text.lang || (typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined);
  return text.content.toLocaleUpperCase(lang === "auto" ? undefined : lang);
}

export function layoutText(ctx: Ctx, text: TextContent, width: number, height: number): TextLayout {
  const style = text.style;
  const unit = unitFor(width, height);
  const px = Math.max(4, style.size * unit);
  const font = fontCss(style, px);
  const spacing = style.spacing * px;
  ctx.font = font;
  setSpacing(ctx, spacing);
  const maxW = Math.max(px * 2, style.width * width);
  const space = ctx.measureText(" ").width;
  const lines: Line[] = [];
  let char = 0;
  let index = 0;
  for (const paragraph of displayText(text).split("\n")) {
    let line: Line = { words: [], w: 0, y: 0 };
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push(line);
      continue;
    }
    for (const word of words) {
      const w = ctx.measureText(word).width;
      const x = line.words.length ? line.w + space : 0;
      if (line.words.length && x + w > maxW) {
        lines.push(line);
        line = { words: [], w: 0, y: 0 };
        line.words.push({ text: word, x: 0, w, char, index });
        line.w = w;
      } else {
        line.words.push({ text: word, x, w, char, index });
        line.w = x + w;
      }
      char += [...word].length;
      index += 1;
    }
    lines.push(line);
  }
  // Trim empty leading/trailing lines (a stray newline) but keep blank lines in between.
  while (lines.length > 1 && !lines[lines.length - 1].words.length) lines.pop();
  const lineH = px * style.lineHeight;
  const blockW = Math.max(...lines.map((l) => l.w), px * 0.5);
  const blockH = lines.length * lineH;
  lines.forEach((l, i) => (l.y = i * lineH + lineH / 2));
  for (const l of lines) {
    const offset = style.align === "left" ? 0 : style.align === "right" ? blockW - l.w : (blockW - l.w) / 2;
    for (const w of l.words) w.x += offset;
  }
  // Keep the block on screen with a small margin.
  const margin = 0.02 * Math.min(width, height);
  const cx = Math.min(Math.max(style.x * width, blockW / 2 + margin), width - blockW / 2 - margin);
  const cy = Math.min(Math.max(style.y * height, blockH / 2 + margin), height - blockH / 2 - margin);
  return { font, px, spacing, lines, w: blockW, h: blockH, left: cx - blockW / 2, top: cy - blockH / 2, chars: char, words: index, space };
}

interface Motion {
  alpha: number;
  tx: number;
  ty: number;
  scale: number;
  /** Characters revealed (typewriter); Infinity = all. */
  chars: number;
  /** Per-word reveal progress for the "words" animation; null = all visible. */
  wordP: ((index: number) => number) | null;
  /** How a revealing word appears: pop (scale) or rise (slides up). */
  wordMode: "pop" | "rise";
  /** Rotation in radians and an extra horizontal scale. */
  rot: number;
  sx: number;
}

/** Bounce easing (lands with two smaller hops). */
function bounceOut(p: number) {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/** Glitchy entrance / exit at progress `p` (1 = settled): jumps sideways and blinks, calming down. */
function glitchMotion(p: number, m: Motion, layout: TextLayout) {
  const slot = Math.floor(p * 18);
  const k = 1 - p;
  m.tx += (hash(slot + 1) - 0.5) * layout.px * 0.9 * k;
  m.ty += (hash(slot + 5) - 0.5) * layout.px * 0.25 * k;
  m.sx *= 1 + (hash(slot + 9) - 0.5) * 0.5 * k;
  m.alpha *= hash(slot + 3) < 0.35 + p ? 1 : 0.2;
}

function inMotion(kind: AnimIn, p: number, m: Motion, layout: TextLayout, width: number, height: number) {
  if (p >= 1 || kind === "none") return;
  const e = easeOut(p);
  const d = layout.px * 1.1;
  switch (kind) {
    case "fade":
      m.alpha *= e;
      break;
    case "rise":
      m.ty += (1 - e) * d;
      m.alpha *= e;
      break;
    case "drop":
      m.ty -= (1 - e) * d;
      m.alpha *= e;
      break;
    case "slideLeft":
      m.tx += (1 - e) * width * 0.12;
      m.alpha *= e;
      break;
    case "slideRight":
      m.tx -= (1 - e) * width * 0.12;
      m.alpha *= e;
      break;
    case "pop":
      m.scale *= 0.4 + 0.6 * backOut(p);
      m.alpha *= clamp01(p * 3);
      break;
    case "zoom":
      m.scale *= 1 + (1 - e) * 0.45;
      m.alpha *= e;
      break;
    case "typewriter":
      m.chars = Math.floor(layout.chars * p);
      break;
    case "words": {
      const n = Math.max(1, layout.words);
      const span = 1 / n;
      m.wordP = (i) => clamp01((p - i * span * 0.85) / Math.max(0.15, span * 1.6));
      break;
    }
    case "wordsRise": {
      const n = Math.max(1, layout.words);
      const span = 1 / n;
      m.wordP = (i) => clamp01((p - i * span * 0.8) / Math.max(0.2, span * 2));
      m.wordMode = "rise";
      break;
    }
    case "spin":
      m.rot -= (1 - e) * Math.PI;
      m.scale *= 0.2 + 0.8 * e;
      m.alpha *= clamp01(p * 2.5);
      break;
    case "bounce":
      m.ty -= (1 - bounceOut(p)) * Math.max(d * 2.5, height * 0.18);
      m.alpha *= clamp01(p * 5);
      break;
    case "flyUp":
      m.ty += (1 - e) * height * 0.4;
      m.alpha *= clamp01(p * 2);
      break;
    case "stretch":
      m.sx *= 0.04 + 0.96 * backOut(p);
      m.alpha *= clamp01(p * 3);
      break;
    case "glitch":
      glitchMotion(p, m, layout);
      break;
  }
}

function outMotion(kind: AnimOut, p: number, m: Motion, layout: TextLayout, width: number, height: number) {
  // p runs 1 -> 0 as the clip ends.
  if (p >= 1 || kind === "none") return;
  const e = easeOut(p);
  const d = layout.px * 1.1;
  switch (kind) {
    case "fade":
      m.alpha *= e;
      break;
    case "rise":
      m.ty -= (1 - e) * d;
      m.alpha *= e;
      break;
    case "sink":
      m.ty += (1 - e) * d;
      m.alpha *= e;
      break;
    case "slideLeft":
      m.tx -= (1 - e) * width * 0.12;
      m.alpha *= e;
      break;
    case "slideRight":
      m.tx += (1 - e) * width * 0.12;
      m.alpha *= e;
      break;
    case "pop":
      m.scale *= 0.3 + 0.7 * e;
      m.alpha *= clamp01(p * 2.5);
      break;
    case "zoom":
      m.scale *= 1 + (1 - e) * 0.5;
      m.alpha *= e;
      break;
    case "spin":
      m.rot += (1 - e) * Math.PI;
      m.scale *= 0.2 + 0.8 * e;
      m.alpha *= clamp01(p * 2.5);
      break;
    case "flyUp":
      m.ty -= (1 - e) * height * 0.4;
      m.alpha *= clamp01(p * 2);
      break;
    case "stretch":
      m.sx *= 0.04 + 0.96 * e;
      m.alpha *= clamp01(p * 3);
      break;
    case "erase":
      m.chars = Math.min(m.chars, Math.ceil(layout.chars * p));
      break;
    case "glitch":
      glitchMotion(p, m, layout);
      break;
  }
}

/** Deterministic noise in [0,1) so previews and exports flicker identically. */
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Phases of a text clip at local time `lt`: whether the picture changes from frame to frame. */
export function isAnimatedAt(text: TextContent, lt: number, duration: number): boolean {
  const a = text.anim;
  if (a.emphasis !== "none") return true;
  if (a.in !== "none" && lt < Math.min(a.inDur, duration)) return true;
  if (a.out !== "none" && lt > duration - Math.min(a.outDur, duration)) return true;
  return false;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp01(alpha)})`;
}

/**
 * Draw one text clip at local time `lt` (seconds since the clip start) of a clip lasting
 * `duration`. The canvas is `width`×`height` project pixels (callers scale the context).
 */
export function drawText(ctx: Ctx, text: TextContent, width: number, height: number, lt: number, duration: number, layout?: TextLayout) {
  const style = text.style;
  const L = layout ?? layoutText(ctx, text, width, height);
  if (!L.chars) return;
  const unit = unitFor(width, height);
  const m: Motion = { alpha: 1, tx: 0, ty: 0, scale: 1, chars: Number.POSITIVE_INFINITY, wordP: null, wordMode: "pop", rot: 0, sx: 1 };
  const a = text.anim;
  const inDur = Math.min(a.inDur, duration * 0.6);
  const outDur = Math.min(a.outDur, duration * 0.6);
  inMotion(a.in, inDur > 0 ? clamp01(lt / inDur) : 1, m, L, width, height);
  outMotion(a.out, outDur > 0 ? clamp01((duration - lt) / outDur) : 1, m, L, width, height);

  let flicker = 1;
  switch (a.emphasis) {
    case "pulse":
      m.scale *= 1 + 0.045 * Math.sin(lt * Math.PI * 2 * 1.4);
      break;
    case "shake": {
      const k = L.px * 0.035;
      m.tx += k * (Math.sin(lt * 61) + 0.6 * Math.sin(lt * 37.3));
      m.ty += k * (Math.cos(lt * 53.7) + 0.6 * Math.sin(lt * 29.1));
      break;
    }
    case "flicker": {
      const slot = Math.floor(lt * 14);
      flicker = hash(slot) < 0.12 ? 0.35 + 0.4 * hash(slot + 7) : 1;
      break;
    }
    case "bounce":
      m.ty -= Math.abs(Math.sin(lt * Math.PI * 1.3)) * L.px * 0.2;
      break;
    case "swing":
      m.rot += Math.sin(lt * Math.PI * 2 * 0.7) * 0.08;
      break;
    case "heartbeat": {
      // Two quick beats, then a rest (about 66 bpm).
      const ph = (lt * 1.1) % 1;
      const bump = (c: number, w: number) => (Math.abs(ph - c) < w ? Math.cos(((ph - c) / w) * (Math.PI / 2)) : 0);
      m.scale *= 1 + 0.09 * bump(0.08, 0.08) + 0.06 * bump(0.3, 0.08);
      break;
    }
    case "breathe":
      flicker = 0.6 + 0.4 * (0.5 + 0.5 * Math.cos(lt * Math.PI * 2 * 0.5));
      m.scale *= 1 + 0.02 * Math.cos(lt * Math.PI * 2 * 0.5);
      break;
    case "jitter": {
      const slot = Math.floor(lt * 12);
      if (hash(slot) < 0.3) {
        m.tx += (hash(slot + 1) - 0.5) * L.px * 0.3;
        m.ty += (hash(slot + 2) - 0.5) * L.px * 0.12;
      }
      break;
    }
  }
  const alpha = clamp01(m.alpha * flicker);
  if (alpha <= 0.002 || m.scale <= 0.01 || m.sx <= 0.01) return;

  // Karaoke progress through the characters, finishing as the out animation starts.
  const singEnd = Math.max(0.1, duration - (a.out !== "none" ? outDur : 0) - 0.05);
  const sung = a.emphasis === "karaoke" ? clamp01(lt / singEnd) * L.chars : -1;

  ctx.save();
  ctx.globalAlpha = alpha;
  const cx = L.left + L.w / 2 + m.tx;
  const cy = L.top + L.h / 2 + m.ty;
  ctx.translate(cx, cy);
  if (m.rot) ctx.rotate(m.rot);
  ctx.scale(m.scale * m.sx, m.scale);
  ctx.translate(-L.w / 2, -L.h / 2);
  ctx.font = L.font;
  setSpacing(ctx, L.spacing);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  // Backgrounds.
  if (style.background !== "none" && style.bgOpacity > 0) {
    ctx.fillStyle = hexAlpha(style.bgColor, style.bgOpacity);
    const padX = L.px * (style.background === "band" ? 0.55 : 0.32);
    const padY = L.px * (style.background === "band" ? 0.28 : 0.12);
    if (style.background === "box") {
      const lineH = L.px * style.lineHeight;
      for (const line of L.lines) {
        if (!line.words.length) continue;
        const x0 = line.words[0].x;
        roundRect(ctx, x0 - padX, line.y - lineH / 2 - padY * 0.2, line.w + padX * 2, lineH + padY * 0.4, L.px * 0.18);
        ctx.fill();
      }
    } else {
      const r = style.background === "pill" ? (L.h + padY * 2) / 2 : L.px * 0.08;
      roundRect(ctx, -padX, -padY, L.w + padX * 2, L.h + padY * 2, Math.min(r, L.px * 0.9));
      ctx.fill();
    }
  }

  const fill = (line: Line): string | CanvasGradient => {
    if (!style.color2) return style.color;
    const g = ctx.createLinearGradient(0, line.y - L.px * 0.45, 0, line.y + L.px * 0.45);
    g.addColorStop(0, style.color);
    g.addColorStop(1, style.color2);
    return g;
  };

  const shadowOn = style.shadow > 0;
  const stroke = style.stroke * unit;

  for (const line of L.lines) {
    for (const word of line.words) {
      if (word.char >= m.chars) continue;
      const glyphs = [...word.text];
      const visible = Math.min(glyphs.length, m.chars - word.char);
      const shown = visible < glyphs.length ? glyphs.slice(0, visible).join("") : word.text;
      let wordAlpha = 1;
      let wordScale = 1;
      let dy = 0;
      if (m.wordP) {
        const p = m.wordP(word.index);
        if (p <= 0) continue;
        wordAlpha = clamp01(p * 2.5);
        if (m.wordMode === "rise") dy += (1 - easeOut(p)) * L.px * 0.6;
        else wordScale = 0.55 + 0.45 * backOut(p);
      }
      if (a.emphasis === "wave") dy += Math.sin(lt * 5.5 + word.index * 0.75) * L.px * 0.09;

      ctx.save();
      if (wordAlpha < 1) ctx.globalAlpha = alpha * wordAlpha;
      const wx = word.x;
      const wy = line.y + dy;
      if (wordScale !== 1) {
        ctx.translate(wx + word.w / 2, wy);
        ctx.scale(wordScale, wordScale);
        ctx.translate(-(wx + word.w / 2), -wy);
      }
      // Glow: blurred copies of the fill underneath.
      if (style.glow > 0) {
        ctx.save();
        ctx.shadowColor = style.color;
        ctx.fillStyle = style.color;
        ctx.shadowBlur = L.px * 0.55 * style.glow;
        ctx.fillText(shown, wx, wy);
        ctx.shadowBlur = L.px * 0.22 * style.glow;
        ctx.fillText(shown, wx, wy);
        ctx.restore();
      }
      if (shadowOn) {
        ctx.shadowColor = `rgba(0, 0, 0, ${0.75 * clamp01(style.shadow)})`;
        ctx.shadowBlur = L.px * 0.14;
        ctx.shadowOffsetY = L.px * 0.05;
      }
      if (stroke > 0) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = stroke * 2;
        ctx.strokeText(shown, wx, wy);
        ctx.shadowColor = "transparent";
      }
      ctx.fillStyle = a.emphasis === "rainbow" ? `hsl(${(lt * 120 + word.index * 40) % 360}, 90%, 62%)` : fill(line);
      ctx.fillText(shown, wx, wy);
      ctx.shadowColor = "transparent";
      // Karaoke: repaint the sung part in the highlight colour, clipped to the progress.
      if (sung > word.char) {
        const n = glyphs.length;
        const done = Math.min(1, (sung - word.char) / Math.max(1, n));
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx - L.px * 0.1, wy - L.px, word.w * done + (done >= 1 ? L.px * 0.2 : 0) + L.px * 0.1, L.px * 2);
        ctx.clip();
        ctx.fillStyle = style.highlight;
        ctx.fillText(shown, wx, wy);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

export interface ActiveText {
  clip: Clip;
  text: TextContent;
  lt: number;
  duration: number;
}

/** Text clips under timeline time `t`, bottom-most track first (upper tracks draw on top). */
export function activeTexts(project: Project, t: number): ActiveText[] {
  const out: ActiveText[] = [];
  const tracks = project.tracks.filter((tr) => tr.kind === "text" && !tr.hidden);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const track = tracks[i];
    for (const clip of project.clips) {
      if (clip.trackId !== track.id || !clip.text) continue;
      if (t < clip.start - 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
      out.push({ clip, text: clip.text, lt: t - clip.start, duration: clipDuration(clip) });
    }
  }
  return out;
}

/** Draw every visible text clip at `t`. The context must already be scaled to project pixels. */
export function drawTexts(ctx: Ctx, project: Project, t: number, width: number, height: number) {
  for (const a of activeLayers(project, t)) {
    if (a.clip.lottie) drawLottie(ctx as CanvasRenderingContext2D, a.clip, width, height, a.lt);
    else if (a.clip.text) drawText(ctx, a.clip.text, width, height, a.lt, a.duration);
  }
}

/** Text and Lottie clips under `t` in drawing order (bottom-most track first). */
export function activeLayers(project: Project, t: number): { clip: Clip; lt: number; duration: number }[] {
  const out: { clip: Clip; lt: number; duration: number }[] = [];
  const tracks = project.tracks.filter((tr) => tr.kind === "text" && !tr.hidden);
  for (let i = tracks.length - 1; i >= 0; i--) {
    for (const clip of project.clips) {
      if (clip.trackId !== tracks[i].id || (!clip.text && !clip.lottie)) continue;
      if (t < clip.start - 1e-6 || t >= clipEnd(clip) - 1e-6) continue;
      out.push({ clip, lt: t - clip.start, duration: clipDuration(clip) });
    }
  }
  return out;
}

/** Key that changes whenever the text picture at `t` changes (frame index for animated phases). */
export function textStateKey(project: Project, t: number, frame: number): string {
  const parts: string[] = [];
  let lottie = false;
  for (const a of activeLayers(project, t)) {
    if (a.clip.lottie) {
      lottie = true;
      parts.push(`${a.clip.id}~${lottieFrameKey(a.clip.lottie, a.clip.in + a.lt * (a.clip.speed || 1))}`);
    } else if (a.clip.text) parts.push(isAnimatedAt(a.clip.text, a.lt, a.duration) ? `${a.clip.id}@${frame}` : a.clip.id);
  }
  if (lottie) parts.push(`v${lottieVersion()}`);
  return parts.join("|");
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}

/** Block box (project pixels) of a text clip, padded a little for easy grabbing. */
export function textBox(text: TextContent, width: number, height: number) {
  const layout = layoutText(measurer(), text, width, height);
  const pad = layout.px * 0.25;
  return { left: layout.left - pad, top: layout.top - pad, w: layout.w + pad * 2, h: layout.h + pad * 2 };
}

/** The top-most text clip visible at `t` whose box contains the point (project pixels). */
export function textAtPoint(project: Project, t: number, x: number, y: number): string | null {
  const active = activeLayers(project, t);
  for (let i = active.length - 1; i >= 0; i--) {
    const { clip } = active[i];
    if (clip.lottie) {
      if (lottieHit(clip.lottie, x, y, project.settings.width, project.settings.height)) return clip.id;
      continue;
    }
    const b = layerBox(clip, project.settings.width, project.settings.height);
    if (b && x >= b.left && x <= b.left + b.w && y >= b.top && y <= b.top + b.h) return clip.id;
  }
  return null;
}

/** On-frame box of a text or Lottie clip (project pixels; rotated Lottie gets its bounding box). */
export function layerBox(clip: Clip, width: number, height: number): { left: number; top: number; w: number; h: number } | null {
  if (clip.text) return textBox(clip.text, width, height);
  if (!clip.lottie) return null;
  const b = lottieBox(clip.lottie, width, height);
  const a = (b.rotation * Math.PI) / 180;
  const w = Math.abs(b.w * Math.cos(a)) + Math.abs(b.h * Math.sin(a));
  const h = Math.abs(b.w * Math.sin(a)) + Math.abs(b.h * Math.cos(a));
  return { left: b.cx - w / 2, top: b.cy - h / 2, w, h };
}

// Lottie (Bodymovin JSON) overlays: lottie-web's light canvas player (no expressions, so no
// eval under the app's CSP) renders each animation into its own offscreen canvas, which the
// text layer then draws with the clip's placement. The preview and the export both go through
// `drawLottie`, so they show the same frames.
import lottie from "lottie-web/build/player/esm/lottie_light_canvas.min.js";
import type { AnimationConfigWithData, AnimationItem } from "lottie-web";
import { loadPackAsset } from "../lib/plugins";
import { clipDuration } from "../project/ops";
import type { Clip, ClipLottie, Project } from "../project/types";

/** Longest side of an offscreen render, in pixels (scaled down from big compositions). */
const MAX_SIDE = 1600;

export interface LottieInfo {
  w: number;
  h: number;
  fr: number;
  ip: number;
  op: number;
  /** Text layers (document order) with their first keyframe's string. */
  texts: string[];
}

// Bodymovin data (parsed once per file) --------------------------------------------------

const data = new Map<string, Promise<unknown | null>>();

export function loadLottieData(path: string): Promise<unknown | null> {
  let p = data.get(path);
  if (!p) {
    p = loadPackAsset(path).then((text) => {
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    });
    data.set(path, p);
  }
  return p;
}

type Json = Record<string, unknown>;

/** The main composition's text layers, in document order (these are the editable ones). */
function textLayers(anim: Json): Json[] {
  return Array.isArray(anim.layers) ? (anim.layers as Json[]).filter((l) => l && l.ty === 5) : [];
}

function docFrames(layer: Json): Json[] {
  const k = ((layer.t as Json | undefined)?.d as Json | undefined)?.k;
  return Array.isArray(k) ? (k as Json[]) : [];
}

export function lottieInfo(anim: unknown): LottieInfo | null {
  if (!anim || typeof anim !== "object") return null;
  const a = anim as Json;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const w = n(a.w, 0), h = n(a.h, 0), fr = n(a.fr, 0), ip = n(a.ip, 0), op = n(a.op, 0);
  if (w <= 0 || h <= 0 || fr <= 0 || op <= ip) return null;
  const texts = textLayers(a).map((l) => String(((docFrames(l)[0]?.s as Json | undefined)?.t as string | undefined) ?? ""));
  return { w, h, fr, ip, op, texts };
}

/** A text layer we draw ourselves: lottie-web's canvas player only draws text from exported
 * glyph outlines, which most files (and any replaced string) don't have. */
interface TextSlot {
  /** Position in the main composition's layer list (= the player's element index). */
  index: number;
  ip: number;
  op: number;
  docs: { t: number; s: Json }[];
}

interface Prepared {
  json: Json;
  slots: TextSlot[];
  fonts: Map<string, { family: string; weight: string; italic: boolean }>;
}

/**
 * A copy for the player: the user's strings go into the text layers, which then become null
 * layers (so their transforms still animate) drawn by `drawSlots`. Text inside precomps keeps
 * lottie's own glyph drawing when the file carries glyphs, else it is left out.
 */
function prepare(anim: unknown, texts: string[] | undefined): Prepared {
  const json = structuredClone(anim) as Json;
  const fonts = new Map<string, { family: string; weight: string; italic: boolean }>();
  for (const f of (((json.fonts as Json | undefined)?.list as Json[] | undefined) ?? [])) {
    const style = String(f.fStyle ?? "");
    const weight = String(f.fWeight ?? "") || (/black|heavy/i.test(style) ? "900" : /extra ?bold/i.test(style) ? "800" : /bold/i.test(style) ? "700" : /semi ?bold/i.test(style) ? "600" : /medium/i.test(style) ? "500" : /light/i.test(style) ? "300" : "400");
    fonts.set(String(f.fName), { family: String(f.fFamily ?? "sans-serif"), weight, italic: /italic|oblique/i.test(style) });
  }
  const glyphs = Array.isArray(json.chars) && (json.chars as unknown[]).length > 0;
  const toNull = (l: Json): Json => ({ ddd: 0, ind: l.ind, ty: 3, nm: l.nm, sr: l.sr ?? 1, ks: l.ks, ao: 0, ip: l.ip, op: l.op, st: l.st ?? 0, bm: 0, ...(l.parent !== undefined ? { parent: l.parent } : {}) });
  const slots: TextSlot[] = [];
  let n = 0;
  const layers = (json.layers as Json[]) ?? [];
  layers.forEach((l, index) => {
    if (!l || l.ty !== 5) return;
    const docs = docFrames(l).map((k) => ({ t: Number(k.t ?? 0), s: { ...(k.s as Json) } }));
    const s = texts?.[n++];
    if (s !== undefined) for (const d of docs) d.s.t = s.replace(/\n/g, "\r");
    slots.push({ index, ip: Number(l.ip ?? 0), op: Number(l.op ?? 0), docs });
    layers[index] = toNull(l);
  });
  if (!glyphs) {
    for (const a of (json.assets as Json[] | undefined) ?? []) {
      if (Array.isArray(a.layers)) a.layers = (a.layers as Json[]).map((l) => (l && l.ty === 5 ? toNull(l) : l));
    }
    delete json.fonts;
  }
  return { json, slots, fonts };
}

interface LottieMatrix {
  props: number[];
  multiply(m: LottieMatrix): LottieMatrix;
  cloneFromProps(p: number[]): void;
}
interface LottieElement {
  finalTransform?: { mProp: { v: LottieMatrix; o?: { v: number } } };
  hierarchy?: LottieElement[];
}

/** Draws the text layers at the player's current frame, in composition pixels scaled by `k`. */
function drawSlots(ctx: CanvasRenderingContext2D, anim: AnimationItem, prep: Prepared, k: number) {
  const elements = (anim as unknown as { renderer: { elements: (LottieElement | null)[] } }).renderer.elements;
  const frame = anim.currentFrame + anim.firstFrame;
  for (const slot of prep.slots) {
    if (frame < slot.ip || frame >= slot.op) continue;
    const el = elements[slot.index];
    const ft = el?.finalTransform;
    if (!ft) continue;
    const own = ft.mProp.v;
    const M = own.constructor as unknown as new () => LottieMatrix;
    const m = new M();
    m.cloneFromProps(own.props.slice());
    for (const parent of el!.hierarchy ?? []) if (parent.finalTransform) m.multiply(parent.finalTransform.mProp.v);
    const opacity = ft.mProp.o?.v ?? 1;
    if (opacity <= 0.002) continue;
    let doc = slot.docs[0]?.s;
    for (const d of slot.docs) if (d.t <= frame) doc = d.s;
    if (!doc) continue;
    const p = m.props;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.transform(p[0], p[1], p[4], p[5], p[12], p[13]);
    ctx.globalAlpha = Math.min(1, opacity);
    drawDoc(ctx, doc, prep.fonts);
    ctx.restore();
  }
}

const colour = (c: unknown) => {
  if (!Array.isArray(c)) return null;
  const v = (c as number[]).slice(0, 3).map((x) => (x <= 1 ? x * 255 : x));
  return `rgb(${v.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(",")})`;
};

/** One Bodymovin text document: lines split on \r, justification, tracking, fill and stroke. */
function drawDoc(ctx: CanvasRenderingContext2D, doc: Json, fonts: Prepared["fonts"]) {
  const size = Number(doc.s ?? 40);
  const f = fonts.get(String(doc.f ?? "")) ?? { family: "sans-serif", weight: "700", italic: false };
  ctx.font = `${f.italic ? "italic " : ""}${f.weight} ${size}px "${f.family}", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const spacing = (Number(doc.tr ?? 0) * size) / 1000;
  const lh = Number(doc.lh ?? size * 1.2);
  const j = Number(doc.j ?? 0);
  const fill = colour(doc.fc);
  const strokeC = colour(doc.sc);
  const sw = Number(doc.sw ?? 0);
  const caps = Number(doc.ca ?? 0) === 1;
  const lines = String(doc.t ?? "").split(/\r\n|\r|\n|\u0003/);
  lines.forEach((raw, i) => {
    const line = caps ? raw.toLocaleUpperCase() : raw;
    const chars = [...line];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const plain = ctx.measureText(line).width;
    const w = spacing ? widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1) : plain;
    const x0 = j === 1 ? -w : j === 2 ? -w / 2 : 0;
    const y = i * lh;
    const paint = (fn: (s: string, x: number, y: number) => void) => {
      if (!spacing) return fn(line, x0, y);
      let x = x0;
      chars.forEach((c, n) => {
        fn(c, x, y);
        x += widths[n] + spacing;
      });
    };
    const doStroke = () => {
      if (!strokeC || sw <= 0) return;
      ctx.strokeStyle = strokeC;
      ctx.lineWidth = sw;
      ctx.lineJoin = "round";
      paint((s, x, yy) => ctx.strokeText(s, x, yy));
    };
    const strokeOver = doc.of === true;
    if (!strokeOver) doStroke();
    if (fill) {
      ctx.fillStyle = fill;
      paint((s, x, yy) => ctx.fillText(s, x, yy));
    }
    if (strokeOver) doStroke();
  });
}

async function loadFonts(fonts: Prepared["fonts"]) {
  if (typeof document === "undefined" || !document.fonts) return;
  const wait = [...fonts.values()].map((f) => document.fonts.load(`${f.italic ? "italic " : ""}${f.weight} 48px "${f.family}"`).catch(() => []));
  await Promise.race([Promise.all(wait), new Promise((r) => setTimeout(r, 3000))]);
}

// Players (one per clip look) -------------------------------------------------------------

interface Player {
  canvas: HTMLCanvasElement;
  anim: AnimationItem | null;
  prep: Prepared | null;
  ready: boolean;
  failed: boolean;
  frame: number;
  used: number;
}

const players = new Map<string, Player>();
const listeners = new Set<() => void>();
let version = 0;

/** Called when a player finishes loading (the picture at the same time has changed). */
export function onLottieReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Bumped whenever a player becomes ready; part of the text layer's state key. */
export function lottieVersion() {
  return version;
}

function playerKey(l: ClipLottie) {
  return `${l.path}\u0000${JSON.stringify(l.texts ?? [])}`;
}

function ready() {
  version++;
  for (const cb of listeners) cb();
}

function player(l: ClipLottie): Player {
  const key = playerKey(l);
  let p = players.get(key);
  if (p) {
    p.used = performance.now();
    return p;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(l.w, l.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(l.w * k));
  canvas.height = Math.max(1, Math.round(l.h * k));
  const fresh: Player = { canvas, anim: null, prep: null, ready: false, failed: false, frame: -1, used: performance.now() };
  players.set(key, fresh);
  prune();
  void loadLottieData(l.path).then(async (json) => {
    if (!json) {
      fresh.failed = true;
      return ready();
    }
    try {
      const prep = prepare(json, l.texts);
      await loadFonts(prep.fonts);
      const anim = lottie.loadAnimation<"canvas">({
        renderer: "canvas",
        loop: false,
        autoplay: false,
        animationData: prep.json,
        rendererSettings: { context: canvas.getContext("2d")!, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
        // No container: the player draws into our own canvas context.
      } as unknown as AnimationConfigWithData<"canvas">);
      fresh.anim = anim;
      fresh.prep = prep;
      const done = () => {
        anim.resize();
        fresh.ready = true;
        ready();
      };
      if (anim.isLoaded) done();
      else {
        anim.addEventListener("DOMLoaded", done);
        anim.addEventListener("data_failed", () => {
          fresh.failed = true;
          ready();
        });
      }
    } catch (e) {
      console.warn("lottie", l.path, e);
      fresh.failed = true;
      ready();
    }
  });
  return fresh;
}

/** Keeps at most 48 players, dropping the least recently used. */
function prune() {
  if (players.size <= 48) return;
  const old = [...players.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, players.size - 48);
  for (const [key, p] of old) {
    p.anim?.destroy();
    players.delete(key);
  }
}

/**
 * lottie-web's canvas renderer remembers which fill/stroke it last put on the context and skips
 * setting it again; once the context state is lost between frames (native restore, resize) it
 * then strokes with the default black. Forgetting the remembered values makes every frame
 * set its own styles.
 */
function resetStyleCache(anim: AnimationItem, canvas: HTMLCanvasElement) {
  const cd = (anim as unknown as { renderer?: { contextData?: Record<string, unknown> } }).renderer?.contextData;
  if (!cd) return;
  cd.appliedFillStyle = cd.appliedStrokeStyle = cd.appliedLineCap = cd.appliedLineJoin = "";
  cd.appliedLineWidth = cd.appliedMiterLimit = -1;
  const ctx = canvas.getContext("2d")!;
  ctx.globalAlpha = 1;
  cd.currentOpacity = 1;
}

/** Frame (relative to `ip`) shown `lt` seconds into a clip. */
export function lottieFrame(l: ClipLottie, lt: number): number {
  const span = l.op - l.ip;
  const f = Math.max(0, lt) * l.fr * (l.rate || 1);
  if (l.loop) return f % span;
  return Math.min(f, span - 1e-3);
}

/** Integer frame for state keys (changes only when the drawn picture can change). */
export function lottieFrameKey(l: ClipLottie, lt: number): number {
  return Math.floor(lottieFrame(l, lt) * 4) / 4;
}

/** Where the animation sits on the frame (project pixels): centre, size and rotation. */
export function lottieBox(l: ClipLottie, width: number, height: number) {
  const fit = Math.min(width / l.w, height / l.h) * l.scale;
  return { cx: l.x * width, cy: l.y * height, w: l.w * fit, h: l.h * fit, rotation: l.rotation };
}

/**
 * Whether the point (project pixels) lands on a drawn part of the clip's current frame (within
 * a few pixels), so full-frame titles don't swallow clicks on empty areas of the stage.
 */
export function lottieHit(l: ClipLottie, x: number, y: number, width: number, height: number): boolean {
  const p = players.get(playerKey(l));
  const b = lottieBox(l, width, height);
  const a = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx, dy = y - b.cy;
  const u = (dx * Math.cos(a) - dy * Math.sin(a)) / b.w + 0.5;
  const v = (dx * Math.sin(a) + dy * Math.cos(a)) / b.h + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  if (!p?.ready) return true;
  const r = 6;
  const px = Math.round(u * p.canvas.width), py = Math.round(v * p.canvas.height);
  try {
    const d = p.canvas.getContext("2d")!.getImageData(px - r, py - r, r * 2 + 1, r * 2 + 1).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 24) return true;
    return false;
  } catch {
    return true;
  }
}

/** Draws a Lottie clip at local time `lt`; false while its player is still loading. */
export function drawLottie(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, clip: Clip, width: number, height: number, lt: number): boolean {
  const l = clip.lottie;
  if (!l) return true;
  const p = player(l);
  if (p.failed) return true;
  if (!p.ready || !p.anim) return false;
  const frame = lottieFrame(l, clip.in + lt * (clip.speed || 1));
  if (Math.abs(frame - p.frame) > 1e-4) {
    resetStyleCache(p.anim, p.canvas);
    p.anim.goToAndStop(frame, true);
    if (p.prep?.slots.length) drawSlots(p.canvas.getContext("2d")!, p.anim, p.prep, p.canvas.width / l.w);
    p.frame = frame;
  }
  const b = lottieBox(l, width, height);
  const duration = clipDuration(clip);
  const fadeIn = clip.fadeIn > 0 ? Math.min(1, lt / clip.fadeIn) : 1;
  const fadeOut = clip.fadeOut > 0 ? Math.min(1, (duration - lt) / clip.fadeOut) : 1;
  const alpha = Math.max(0, Math.min(1, clip.opacity * fadeIn * fadeOut));
  if (alpha <= 0.002) return true;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.cx, b.cy);
  if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
  ctx.drawImage(p.canvas, -b.w / 2, -b.h / 2, b.w, b.h);
  ctx.restore();
  return true;
}

/** Waits until every Lottie clip of the project can draw (export). */
export async function preloadLotties(project: Project): Promise<void> {
  const clips = project.clips.filter((c) => c.lottie);
  const pending = () => clips.filter((c) => { const p = player(c.lottie!); return !p.ready && !p.failed; });
  for (let i = 0; i < 300 && pending().length; i++) await new Promise((r) => setTimeout(r, 50));
}

/** Clip fields for a new Lottie clip from a pack entry. */
export function lottieClipData(path: string, name: string, kind: "overlay" | "text", info: LottieInfo, packId: string | undefined, projectW: number, projectH: number): ClipLottie {
  const frameLike = Math.abs(info.w / info.h - projectW / projectH) < 0.02;
  return {
    path,
    name,
    kind,
    packId,
    w: info.w,
    h: info.h,
    fr: info.fr,
    ip: info.ip,
    op: info.op,
    x: 0.5,
    y: 0.5,
    scale: frameLike || kind === "text" ? 1 : 0.45,
    rotation: 0,
    loop: kind === "overlay",
    rate: 1,
    texts: info.texts.length ? info.texts : undefined,
  };
}

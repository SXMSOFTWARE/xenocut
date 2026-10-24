// Video effects for clips and effect layers. Mirrors `src-tauri/src/effects.rs`: the constants
// below have twins there, so the live preview (CSS / SVG filters, overlays and transforms) matches
// the ffmpeg export.
//
// Every effect may cover only part of its clip: `from` / `to` in seconds from the clip start
// (half-open [from, to)). Packs (fx-packs.json) expand into primitives that share the range.
// At any moment, colour adjustments, flashes and dips stack; every other kind is "last active
// wins". Order is fixed no matter how effects are listed: flips → colour → sharpen → RGB split →
// blur → vignette → grain → scanlines → flash → dip to black → letterbox → zoom / shake.
import type { Clip } from "./types";
import PACKS_JSON from "./fx-packs.json";

export type PrimitiveKind =
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "bw"
  | "sepia"
  | "invert"
  | "sharpen"
  | "blur"
  | "rgbSplit"
  | "vignette"
  | "grain"
  | "scanlines"
  | "letterbox"
  | "mirror"
  | "flip"
  | "zoomIn"
  | "zoomOut"
  | "shake"
  | "flash"
  | "punch"
  | "hitShake"
  | "fadeIn"
  | "fadeOut";

export type PackKind =
  | "cinematic"
  | "vintage"
  | "vhs"
  | "noir"
  | "dreamy"
  | "punchy"
  | "cold"
  | "sunset"
  | "faded"
  | "glitch"
  | "crt"
  | "oldFilm"
  | "softFocus"
  | "heavyBlur"
  | "earthquake"
  | "amvHit"
  | "beatGlitch"
  | "widescreen";

export type EffectKind = PrimitiveKind | PackKind;

export interface ClipEffect {
  kind: EffectKind;
  /** 0..1, or -1..1 for the signed colour adjustments. Toggles ignore it. */
  amount: number;
  /** Start, seconds from the clip start. Absent = the clip start. */
  from?: number;
  /** End, seconds from the clip start. Absent = the clip end. */
  to?: number;
}

const { _comment: _, ...packTable } = PACKS_JSON as Record<string, unknown>;
export const PACKS = packTable as Record<PackKind, [PrimitiveKind, number][]>;
export const isPack = (kind: EffectKind): kind is PackKind => kind in PACKS;

export type EffectCategory = "basic" | "color" | "glitch" | "blur" | "retro" | "transition" | "overlay" | "motion" | "amv";
export const CATEGORIES: EffectCategory[] = ["basic", "color", "glitch", "blur", "retro", "transition", "overlay", "motion", "amv"];

export interface EffectDef {
  kind: EffectKind;
  /** Categories in the effect browser (first one is the home category). */
  cats: EffectCategory[];
  /** Signed slider (-100..100) centred on 0. */
  signed?: boolean;
  /** On/off only, no amount. */
  toggle?: boolean;
  /** Amount when added. */
  initial: number;
  /** Plays once from the start of its range (beat hits, dips): added as a short range by default. */
  hit?: boolean;
}

export const EFFECTS: EffectDef[] = [
  { kind: "brightness", cats: ["basic"], signed: true, initial: 0.2 },
  { kind: "contrast", cats: ["basic"], signed: true, initial: 0.2 },
  { kind: "saturation", cats: ["basic", "color"], signed: true, initial: 0.3 },
  { kind: "temperature", cats: ["basic", "color"], signed: true, initial: 0.4 },
  { kind: "sharpen", cats: ["basic"], initial: 0.4 },
  { kind: "punchy", cats: ["color", "basic"], initial: 1 },
  { kind: "bw", cats: ["color"], initial: 1 },
  { kind: "sepia", cats: ["color", "retro"], initial: 0.8 },
  { kind: "invert", cats: ["color", "glitch"], initial: 1 },
  { kind: "cinematic", cats: ["color"], initial: 1 },
  { kind: "noir", cats: ["color", "retro"], initial: 1 },
  { kind: "cold", cats: ["color"], initial: 1 },
  { kind: "sunset", cats: ["color"], initial: 1 },
  { kind: "faded", cats: ["color", "retro"], initial: 1 },
  { kind: "rgbSplit", cats: ["glitch"], initial: 0.4 },
  { kind: "glitch", cats: ["glitch"], initial: 1 },
  { kind: "beatGlitch", cats: ["glitch", "amv"], initial: 1, hit: true },
  { kind: "crt", cats: ["glitch", "retro"], initial: 1 },
  { kind: "blur", cats: ["blur"], initial: 0.3 },
  { kind: "softFocus", cats: ["blur"], initial: 1 },
  { kind: "dreamy", cats: ["blur", "color"], initial: 1 },
  { kind: "heavyBlur", cats: ["blur"], initial: 1 },
  { kind: "vhs", cats: ["retro", "glitch"], initial: 1 },
  { kind: "vintage", cats: ["retro"], initial: 1 },
  { kind: "oldFilm", cats: ["retro"], initial: 1 },
  { kind: "grain", cats: ["retro", "overlay"], initial: 0.35 },
  { kind: "scanlines", cats: ["retro", "overlay"], initial: 0.6 },
  { kind: "fadeIn", cats: ["transition"], toggle: true, initial: 1, hit: true },
  { kind: "fadeOut", cats: ["transition"], toggle: true, initial: 1, hit: true },
  { kind: "flash", cats: ["transition", "amv"], initial: 0.7, hit: true },
  { kind: "zoomIn", cats: ["transition", "motion"], initial: 0.4 },
  { kind: "zoomOut", cats: ["transition", "motion"], initial: 0.4 },
  { kind: "vignette", cats: ["overlay"], initial: 0.5 },
  { kind: "letterbox", cats: ["overlay"], initial: 1 },
  { kind: "widescreen", cats: ["overlay", "color"], initial: 1 },
  { kind: "shake", cats: ["motion"], initial: 0.5 },
  { kind: "earthquake", cats: ["motion", "glitch"], initial: 1 },
  { kind: "mirror", cats: ["motion"], toggle: true, initial: 1 },
  { kind: "flip", cats: ["motion"], toggle: true, initial: 1 },
  { kind: "punch", cats: ["amv", "motion"], initial: 0.6, hit: true },
  { kind: "hitShake", cats: ["amv", "motion"], initial: 0.6, hit: true },
  { kind: "amvHit", cats: ["amv"], initial: 1, hit: true },
];

export const EFFECT_DEF = Object.fromEntries(EFFECTS.map((d) => [d.kind, d])) as Record<EffectKind, EffectDef>;

export const ZOOM_RANGE = 0.35;
export const SHAKE_RANGE = 0.025;
export const BLUR_SIGMA = 0.015;
export const RGB_SPLIT = 0.01;
export const VIGNETTE_ANGLE = 1.3;
export const GRAIN_STRENGTH = 40;
export const SHARPEN_AMOUNT = 2;
/** Beat hits play at the start of their range: white flash fading over `amount * FLASH_DECAY` s. */
export const FLASH_DECAY = 0.25;
export const PUNCH_RANGE = 0.12;
export const PUNCH_DECAY = 0.35;
/** Effects that play once at the clip start (the beat hits). */
export const HIT_KINDS: EffectKind[] = ["flash", "punch", "hitShake"];
export const HIT_SHAKE_RANGE = 0.04;
export const HIT_SHAKE_DECAY = 0.4;
/** Letterbox: each bar covers up to this fraction of the picture height. */
export const LETTERBOX = 0.12;
/** Scanlines: a dark line every `period` canvas px (canvas height / SCANLINE_ROWS), half as thick. */
export const SCANLINE_ROWS = 180;
export const SCANLINE_ALPHA = 0.5;
const SHAKE_X: [number, number, number][] = [
  [0.6, 7.3, 0],
  [0.4, 11.1, 1.3],
];
const SHAKE_Y: [number, number, number][] = [
  [0.6, 8.7, 0.7],
  [0.4, 13.3, 2.1],
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** One primitive effect over [a, b) seconds of local time. */
export interface Instance {
  kind: PrimitiveKind;
  amount: number;
  a: number;
  b: number;
}

/** Packs expanded and ranges resolved against a clip / layer `length` seconds long. */
export function expand(effects: ClipEffect[], length: number): Instance[] {
  const out: Instance[] = [];
  for (const e of effects) {
    const a = clamp(e.from ?? 0, 0, length);
    const b = e.to == null ? length : clamp(e.to, a, length);
    if (b <= a) continue;
    if (isPack(e.kind)) for (const [kind, base] of PACKS[e.kind]) out.push({ kind, amount: base * e.amount, a, b });
    else if (EFFECT_DEF[e.kind]) out.push({ kind: e.kind, amount: e.amount, a, b });
  }
  return out;
}

/** Scanline period and thickness in canvas px for a canvas `height` px tall. */
export function scanlineGeometry(height: number): { period: number; thick: number } {
  const period = Math.max(2, Math.round(height / SCANLINE_ROWS));
  return { period, thick: Math.max(1, Math.round(period / 2)) };
}

export function clipEffects(clip: Clip): ClipEffect[] {
  return clip.effects ?? [];
}

const COLOR_KINDS = new Set<PrimitiveKind>(["brightness", "contrast", "saturation", "temperature", "bw", "sepia", "invert"]);

/** CSS filter function for one colour effect. `temperature` needs the SVG defs. */
function colorFilter(e: Instance): string {
  const s = clamp(e.amount, -1, 1);
  const u = clamp(e.amount, 0, 1);
  switch (e.kind) {
    case "brightness":
      return `brightness(${1 + 0.5 * s})`;
    case "contrast":
      return `contrast(${1 + 0.6 * s})`;
    case "saturation":
      return `saturate(${1 + s})`;
    case "temperature":
      return `url(#xc-fx-temp-${Math.round(s * 100)})`;
    case "bw":
      return `grayscale(${u})`;
    case "sepia":
      return `sepia(${u})`;
    case "invert":
      return `invert(${u})`;
    default:
      return "";
  }
}

/** Temperature gains for an amount in percent (-100..100), as an feColorMatrix. */
export function temperatureMatrix(percent: number): string {
  const a = clamp(percent / 100, -1, 1);
  return `${1 + 0.12 * a} 0 0 0 0 0 1 0 0 0 0 0 ${1 - 0.12 * a} 0 0 0 0 0 1 0`;
}

/** Every temperature value the clips use (packs included), so the editor renders one SVG filter per value. */
export function temperatureValues(clips: Clip[]): number[] {
  const set = new Set<number>();
  for (const c of clips) for (const e of expand(c.effects ?? [], 1e9)) if (e.kind === "temperature") set.add(Math.round(clamp(e.amount, -1, 1) * 100));
  return [...set];
}

export interface Motion {
  scaleX: number;
  scaleY: number;
  /** Translation as a fraction of the canvas. */
  dx: number;
  dy: number;
}

/** Everything the preview needs to show effects at one moment. */
export interface FxState {
  /** CSS `filter` for the picture ("" for none). `svgId` is used for sharpen / RGB split. */
  filter: string;
  /** SVG sharpen / RGB split filter needed (rendered by the engine into the `svgId` filter). */
  svg: { sharpen: number; split: number } | null;
  vignette: number;
  grain: number;
  /** Scanline opacity (0 = none); geometry from `scanlineGeometry`. */
  scanlines: number;
  /** White over the picture, 0..1. */
  flash: number;
  /** Black over the picture, 0..1 (fade in / fade out). */
  dip: number;
  /** Each letterbox bar as a fraction of the picture height. */
  letterbox: number;
  motion: Motion | null;
}

const active = (e: Instance, tau: number) => tau >= e.a && tau < e.b;

/** The last active instance of a kind (last in list order wins). */
function winner(list: Instance[], kind: PrimitiveKind, tau: number): Instance | null {
  let w: Instance | null = null;
  for (const e of list) if (e.kind === kind && active(e, tau)) w = e;
  return w;
}

const ease = (tau: number, decay: number) => Math.max(0, 1 - Math.max(0, tau) / decay) ** 2;

/** White left by one flash at local time `tau` (export: `fade` from white, see effects.rs). */
const flashOf = (e: Instance, tau: number) => clamp(clamp(e.amount, 0, 1) - (tau - e.a) / FLASH_DECAY, 0, 1);

/**
 * Effects at local time `tau` (seconds from the clip / layer start) of something `length` long.
 * `projectHeight` is the canvas height; `scale` converts canvas px to on-screen CSS px.
 */
export function fxAt(effects: ClipEffect[], tau: number, length: number, projectHeight: number, scale: number, svgId = "xc-fx-svg"): FxState {
  const list = expand(effects, length);
  const parts: string[] = [];
  let flashKeep = 1;
  let dipKeep = 1;
  for (const e of list) {
    if (!active(e, tau)) continue;
    if (COLOR_KINDS.has(e.kind)) parts.push(colorFilter(e));
    else if (e.kind === "flash") flashKeep *= 1 - flashOf(e, tau);
    else if (e.kind === "fadeIn") dipKeep *= clamp((tau - e.a) / (e.b - e.a), 0, 1);
    else if (e.kind === "fadeOut") dipKeep *= 1 - clamp((tau - e.a) / (e.b - e.a), 0, 1);
  }
  const amt = (kind: PrimitiveKind) => winner(list, kind, tau)?.amount ?? 0;
  const sharpen = clamp(amt("sharpen"), 0, 1);
  const split = Math.round(clamp(amt("rgbSplit"), 0, 1) * RGB_SPLIT * projectHeight) * scale;
  const svg = sharpen > 0 || split > 0 ? { sharpen, split: Math.round(split * 100) / 100 } : null;
  if (svg) parts.push(`url(#${svgId})`);
  const blur = clamp(amt("blur"), 0, 1) * BLUR_SIGMA * projectHeight;
  if (blur >= 0.1) parts.push(`blur(${(blur * scale).toFixed(2)}px)`);
  return {
    filter: parts.join(" "),
    svg,
    vignette: clamp(amt("vignette"), 0, 1),
    grain: clamp(amt("grain"), 0, 1),
    scanlines: clamp(amt("scanlines"), 0, 1) * SCANLINE_ALPHA,
    flash: 1 - flashKeep,
    dip: 1 - dipKeep,
    letterbox: clamp(amt("letterbox"), 0, 1) * LETTERBOX,
    motion: motionOf(list, tau),
  };
}

/** Static look of an effect list (its state at the start), for swatches. */
export function previewFx(effects: ClipEffect[], projectHeight: number, scale: number): FxState {
  return fxAt(effects, 0, 1e9, projectHeight, scale);
}

/**
 * ffmpeg `vignette` darkens by 1 - cos(angle * d)^4, d = distance from the centre over the half
 * diagonal, which is exactly a CSS `circle farthest-corner` gradient. Sampled into stops.
 */
export function vignetteGradient(a: number): string {
  const angle = clamp(a, 0, 1) * VIGNETTE_ANGLE;
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const d = i / 10;
    const c = Math.cos(angle * d) ** 4;
    stops.push(`rgba(0,0,0,${(1 - c).toFixed(3)}) ${d * 100}%`);
  }
  return `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(", ")})`;
}

/** Scanlines as a CSS background; `scale` = on-screen px per canvas px. */
export function scanlineBackground(alpha: number, projectHeight: number, scale: number): string {
  const { period, thick } = scanlineGeometry(projectHeight);
  const p = (period * scale).toFixed(3);
  const t = (thick * scale).toFixed(3);
  const c = `rgba(0,0,0,${alpha.toFixed(3)})`;
  return `repeating-linear-gradient(to bottom, ${c} 0px, ${c} ${t}px, transparent ${t}px, transparent ${p}px)`;
}

/** Letterbox bars as a CSS background (`f` = bar height over picture height). */
export function letterboxBackground(f: number): string {
  const top = (f * 100).toFixed(3);
  const bottom = (100 - f * 100).toFixed(3);
  return `linear-gradient(to bottom, #000 0%, #000 ${top}%, transparent ${top}%, transparent ${bottom}%, #000 ${bottom}%, #000 100%)`;
}

/** Zoom / shake / flips at local time `tau` (the export builds the same expression, see effects.rs). */
function motionOf(list: Instance[], tau: number): Motion | null {
  const zin = winner(list, "zoomIn", tau);
  const zout = winner(list, "zoomOut", tau);
  const shakeI = winner(list, "shake", tau);
  const punchI = winner(list, "punch", tau);
  const hitI = winner(list, "hitShake", tau);
  const mirror = winner(list, "mirror", tau) !== null;
  const flip = winner(list, "flip", tau) !== null;
  if (!zin && !zout && !shakeI && !punchI && !hitI && !mirror && !flip) return null;
  const prog = (e: Instance) => clamp((tau - e.a) / Math.max(1e-3, e.b - e.a), 0, 1);
  let z = 1;
  if (zin) z *= 1 + clamp(zin.amount, 0, 1) * ZOOM_RANGE * prog(zin);
  if (zout) z *= 1 + clamp(zout.amount, 0, 1) * ZOOM_RANGE * (1 - prog(zout));
  if (punchI) z *= 1 + clamp(punchI.amount, 0, 1) * PUNCH_RANGE * ease(tau - punchI.a, PUNCH_DECAY);
  let dx = 0;
  let dy = 0;
  const shake = shakeI ? clamp(shakeI.amount, 0, 1) * SHAKE_RANGE : 0;
  const hit = hitI ? clamp(hitI.amount, 0, 1) * HIT_SHAKE_RANGE * ease(tau - hitI.a, HIT_SHAKE_DECAY) : 0;
  if (shakeI || hitI) {
    const amp = shake + hit;
    z *= 1 + 2.2 * amp;
    const wave = (parts: [number, number, number][]) => amp * parts.reduce((s, [w, f, ph]) => s + w * Math.sin(2 * Math.PI * f * tau + ph), 0);
    dx = wave(SHAKE_X);
    dy = wave(SHAKE_Y);
  }
  // The export samples a window of 1/z centred at (0.5 + dx, 0.5 + dy): content moves by -z * d.
  return { scaleX: mirror ? -z : z, scaleY: flip ? -z : z, dx: -z * dx, dy: -z * dy };
}

export function motionCss(m: Motion | null): string {
  if (!m) return "";
  return `translate(${(m.dx * 100).toFixed(3)}%, ${(m.dy * 100).toFixed(3)}%) scale(${m.scaleX.toFixed(4)}, ${m.scaleY.toFixed(4)})`;
}

const ANIMATED = new Set<PrimitiveKind>(["zoomIn", "zoomOut", "shake", "flash", "punch", "hitShake", "fadeIn", "fadeOut"]);

/** Is anything animated or time-ranged (needs a re-render every frame while scrubbing)? */
export function hasMotion(effects: ClipEffect[]): boolean {
  return effects.some((e) => e.from != null || e.to != null) || expand(effects, 1e9).some((e) => ANIMATED.has(e.kind));
}

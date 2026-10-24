// Per-clip video effects. Mirrors `src-tauri/src/effects.rs`: the constants below have twins
// there, so the live preview (CSS / SVG filters and transforms) matches the ffmpeg export.
// Order is fixed no matter how effects are listed: flips → colour → sharpen → RGB split → blur
// → vignette → grain → zoom / shake.
import type { Clip } from "./types";

export type EffectKind =
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
  | "mirror"
  | "flip"
  | "zoomIn"
  | "zoomOut"
  | "shake"
  | "flash"
  | "punch"
  | "hitShake";

export interface ClipEffect {
  kind: EffectKind;
  /** 0..1, or -1..1 for the signed colour adjustments. Toggles ignore it. */
  amount: number;
}

export type EffectGroup = "adjust" | "look" | "motion" | "hit";

export interface EffectDef {
  kind: EffectKind;
  group: EffectGroup;
  /** Signed slider (-100..100) centred on 0. */
  signed?: boolean;
  /** On/off only, no amount. */
  toggle?: boolean;
  /** Amount when added. */
  initial: number;
}

export const EFFECTS: EffectDef[] = [
  { kind: "brightness", group: "adjust", signed: true, initial: 0.2 },
  { kind: "contrast", group: "adjust", signed: true, initial: 0.2 },
  { kind: "saturation", group: "adjust", signed: true, initial: 0.3 },
  { kind: "temperature", group: "adjust", signed: true, initial: 0.4 },
  { kind: "bw", group: "look", initial: 1 },
  { kind: "sepia", group: "look", initial: 0.8 },
  { kind: "invert", group: "look", initial: 1 },
  { kind: "sharpen", group: "look", initial: 0.4 },
  { kind: "blur", group: "look", initial: 0.3 },
  { kind: "rgbSplit", group: "look", initial: 0.4 },
  { kind: "vignette", group: "look", initial: 0.5 },
  { kind: "grain", group: "look", initial: 0.35 },
  { kind: "zoomIn", group: "motion", initial: 0.4 },
  { kind: "zoomOut", group: "motion", initial: 0.4 },
  { kind: "shake", group: "motion", initial: 0.5 },
  { kind: "mirror", group: "motion", toggle: true, initial: 1 },
  { kind: "flip", group: "motion", toggle: true, initial: 1 },
  { kind: "flash", group: "hit", initial: 0.7 },
  { kind: "punch", group: "hit", initial: 0.6 },
  { kind: "hitShake", group: "hit", initial: 0.6 },
];

export const EFFECT_DEF = Object.fromEntries(EFFECTS.map((d) => [d.kind, d])) as Record<EffectKind, EffectDef>;

export const ZOOM_RANGE = 0.35;
export const SHAKE_RANGE = 0.025;
export const BLUR_SIGMA = 0.015;
export const RGB_SPLIT = 0.01;
export const VIGNETTE_ANGLE = 1.3;
export const GRAIN_STRENGTH = 40;
export const SHARPEN_AMOUNT = 2;
/** Beat hits play at the clip start: white flash fading over `amount * FLASH_DECAY` s. */
export const FLASH_DECAY = 0.25;
export const PUNCH_RANGE = 0.12;
export const PUNCH_DECAY = 0.35;
/** Effects that play once at the clip start (the beat hits). */
export const HIT_KINDS: EffectKind[] = ["flash", "punch", "hitShake"];
export const HIT_SHAKE_RANGE = 0.04;
export const HIT_SHAKE_DECAY = 0.4;
const SHAKE_X: [number, number, number][] = [
  [0.6, 7.3, 0],
  [0.4, 11.1, 1.3],
];
const SHAKE_Y: [number, number, number][] = [
  [0.6, 8.7, 0.7],
  [0.4, 13.3, 2.1],
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function amount(effects: ClipEffect[], kind: EffectKind): number {
  let a = 0;
  for (const e of effects) if (e.kind === kind) a = e.amount;
  return a;
}

const has = (effects: ClipEffect[], kind: EffectKind) => effects.some((e) => e.kind === kind);

export function clipEffects(clip: Clip): ClipEffect[] {
  return clip.effects ?? [];
}

/** CSS filter functions for the colour effects, in list order. `temperature` needs the SVG defs. */
function colorFilters(effects: ClipEffect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    const s = clamp(e.amount, -1, 1);
    const u = clamp(e.amount, 0, 1);
    switch (e.kind) {
      case "brightness":
        out.push(`brightness(${1 + 0.5 * s})`);
        break;
      case "contrast":
        out.push(`contrast(${1 + 0.6 * s})`);
        break;
      case "saturation":
        out.push(`saturate(${1 + s})`);
        break;
      case "temperature":
        out.push(`url(#xc-fx-temp-${Math.round(s * 100)})`);
        break;
      case "bw":
        out.push(`grayscale(${u})`);
        break;
      case "sepia":
        out.push(`sepia(${u})`);
        break;
      case "invert":
        out.push(`invert(${u})`);
        break;
    }
  }
  return out;
}

/** Temperature gains for an amount in percent (-100..100), as an feColorMatrix. */
export function temperatureMatrix(percent: number): string {
  const a = clamp(percent / 100, -1, 1);
  return `${1 + 0.12 * a} 0 0 0 0 0 1 0 0 0 0 0 ${1 - 0.12 * a} 0 0 0 0 0 1 0`;
}

/** Every temperature value a clip uses, so the editor can render one SVG filter per value. */
export function temperatureValues(clips: Clip[]): number[] {
  const set = new Set<number>();
  for (const c of clips) for (const e of c.effects ?? []) if (e.kind === "temperature") set.add(Math.round(clamp(e.amount, -1, 1) * 100));
  return [...set];
}

export interface PreviewFx {
  /** CSS `filter` for the media element ("" for none). */
  filter: string;
  /** SVG sharpen / RGB split filter needed (rendered by the engine into #xc-fx-svg). */
  svg: { sharpen: number; split: number } | null;
  vignette: number;
  grain: number;
}

/**
 * Preview filter for a clip. `scale` converts canvas pixels to on-screen CSS pixels
 * (stage height / project height), so blur and RGB split read the same at any preview size.
 */
export function previewFx(effects: ClipEffect[], projectHeight: number, scale: number): PreviewFx {
  const parts = colorFilters(effects);
  const sharpen = clamp(amount(effects, "sharpen"), 0, 1);
  const split = Math.round(clamp(amount(effects, "rgbSplit"), 0, 1) * RGB_SPLIT * projectHeight) * scale;
  const svg = sharpen > 0 || split > 0 ? { sharpen, split: Math.round(split * 100) / 100 } : null;
  if (svg) parts.push("url(#xc-fx-svg)");
  const blur = clamp(amount(effects, "blur"), 0, 1) * BLUR_SIGMA * projectHeight;
  if (blur >= 0.1) parts.push(`blur(${(blur * scale).toFixed(2)}px)`);
  return {
    filter: parts.join(" "),
    svg,
    vignette: clamp(amount(effects, "vignette"), 0, 1),
    grain: clamp(amount(effects, "grain"), 0, 1),
  };
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

export interface Motion {
  scaleX: number;
  scaleY: number;
  /** Translation as a fraction of the canvas. */
  dx: number;
  dy: number;
}

/** White flash opacity at local time `tau` (export: `fade` from white, see effects.rs). */
export function flashAt(effects: ClipEffect[], tau: number): number {
  const a = clamp(amount(effects, "flash"), 0, 1);
  return a > 0 ? clamp(a - Math.max(0, tau) / FLASH_DECAY, 0, 1) : 0;
}

const ease = (tau: number, decay: number) => Math.max(0, 1 - Math.max(0, tau) / decay) ** 2;

/** Zoom / shake / flips at local time `tau` (seconds from the clip start) of a clip `length` long. */
export function motionAt(effects: ClipEffect[], tau: number, length: number): Motion | null {
  const zin = clamp(amount(effects, "zoomIn"), 0, 1) * ZOOM_RANGE;
  const zout = clamp(amount(effects, "zoomOut"), 0, 1) * ZOOM_RANGE;
  const shake = clamp(amount(effects, "shake"), 0, 1) * SHAKE_RANGE;
  const punch = clamp(amount(effects, "punch"), 0, 1) * PUNCH_RANGE;
  const hit = clamp(amount(effects, "hitShake"), 0, 1) * HIT_SHAKE_RANGE;
  const mirror = has(effects, "mirror");
  const flip = has(effects, "flip");
  if (zin <= 0 && zout <= 0 && shake <= 0 && punch <= 0 && hit <= 0 && !mirror && !flip) return null;
  const p = clamp(tau / Math.max(1e-3, length), 0, 1);
  let z = 1;
  if (zin > 0) z *= 1 + zin * p;
  if (zout > 0) z *= 1 + zout * (1 - p);
  if (punch > 0) z *= 1 + punch * ease(tau, PUNCH_DECAY);
  let dx = 0;
  let dy = 0;
  const amp = shake + (hit > 0 ? hit * ease(tau, HIT_SHAKE_DECAY) : 0);
  if (shake > 0 || hit > 0) {
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

/** Is anything animated (needs a re-render every frame while paused scrubbing)? */
export function hasMotion(effects: ClipEffect[]): boolean {
  return effects.some((e) => ["zoomIn", "zoomOut", "shake", "flash", "punch", "hitShake"].includes(e.kind));
}

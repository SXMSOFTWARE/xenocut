/** Clip animations (In / Out / Combo), CapCut style. The tables live in clip-anims.json, shared
 *  with src-tauri/src/anims.rs, so the preview and the export compute the same curves. */
import TABLE from "./clip-anims.json";
import type { ClipEffect, PrimitiveKind } from "./effects";

type Fx = [PrimitiveKind, number, number, number];
interface EdgeDef {
  s?: number;
  tx?: number;
  ty?: number;
  rot?: number;
  alpha?: boolean;
  alphaSpan?: number;
  curve: "ease" | "back" | "bounce" | "linear";
  fx?: Fx[];
}
type Wave = "sin" | "bump" | "beat" | "turn" | "ramp" | "ramp1";
interface ComboDef {
  terms: ["s" | "tx" | "ty" | "rot", number, Wave][];
  duration: number;
  fx?: Fx[];
}

const { in: IN_TABLE, combo: COMBO_TABLE } = TABLE as unknown as { in: Record<string, EdgeDef>; combo: Record<string, ComboDef> };

export type EdgeKind = keyof typeof TABLE.in;
export type ComboKind = keyof typeof TABLE.combo;
export const EDGE_KINDS = Object.keys(IN_TABLE) as EdgeKind[];
export const COMBO_KINDS = Object.keys(COMBO_TABLE) as ComboKind[];

export interface AnimSlot<K extends string = string> {
  kind: K;
  /** Seconds (In/Out: the window; Combo: the loop period). */
  duration: number;
}
export interface ClipAnim {
  in?: AnimSlot<EdgeKind>;
  out?: AnimSlot<EdgeKind>;
  combo?: AnimSlot<ComboKind>;
}

export const DEFAULT_EDGE = 0.5;
export const comboDefault = (kind: ComboKind) => COMBO_TABLE[kind]?.duration ?? 1;

/** Share of the window still "hidden" at progress p (1 = fully hidden, 0 = settled). */
export function hidden(curve: EdgeDef["curve"], p: number): number {
  const q = Math.min(1, Math.max(0, p));
  switch (curve) {
    case "linear":
      return 1 - q;
    case "back": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return -(c3 * (q - 1) ** 3 + c1 * (q - 1) ** 2);
    }
    case "bounce":
      return Math.abs(Math.cos(7.853982 * q)) * (1 - q) ** 2;
    default:
      return (1 - q) ** 3;
  }
}

function wave(w: Wave, t: number, period: number, length: number): number {
  const u = t / Math.max(0.05, period);
  switch (w) {
    case "sin":
      return Math.sin(2 * Math.PI * u);
    case "bump":
      return 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    case "beat":
      return Math.abs(Math.sin(Math.PI * u)) ** 12;
    case "turn":
      return u;
    case "ramp":
      return Math.min(1, t / Math.max(1e-3, length));
    case "ramp1":
      return 1 - Math.min(1, t / Math.max(1e-3, length));
  }
}

/** In and Out windows fitted into the clip (In first, Out gets what is left). */
export function windows(anim: ClipAnim | undefined, length: number): { din: number; dout: number } {
  const din = anim?.in && IN_TABLE[anim.in.kind] ? Math.min(Math.max(0.05, anim.in.duration), length) : 0;
  const dout = anim?.out && IN_TABLE[anim.out.kind] ? Math.min(Math.max(0.05, anim.out.duration), Math.max(0, length - din)) : 0;
  return { din, dout };
}

export interface AnimState {
  s: number;
  tx: number;
  ty: number;
  rot: number;
  alpha: number;
}

/** The transform and opacity at local time t. */
export function animAt(anim: ClipAnim | undefined, t: number, length: number): AnimState {
  const st: AnimState = { s: 1, tx: 0, ty: 0, rot: 0, alpha: 1 };
  if (!anim) return st;
  const { din, dout } = windows(anim, length);
  const edge = (def: EdgeDef, p: number, d: number, elapsed: number) => {
    const f = hidden(def.curve, p);
    st.s *= 1 + ((def.s ?? 1) - 1) * f;
    st.tx += (def.tx ?? 0) * f;
    st.ty += (def.ty ?? 0) * f;
    st.rot += (def.rot ?? 0) * f;
    if (def.alpha) st.alpha *= Math.min(1, elapsed / Math.max(1e-3, d * (def.alphaSpan ?? 1)));
  };
  if (din > 0) edge(IN_TABLE[anim.in!.kind], t / din, din, t);
  if (dout > 0) edge(IN_TABLE[anim.out!.kind], (length - t) / dout, dout, length - t);
  const combo = anim.combo && COMBO_TABLE[anim.combo.kind];
  if (combo) {
    let s = 1;
    for (const [param, amp, w] of combo.terms) {
      const v = amp * wave(w, t, anim.combo!.duration, length);
      if (param === "s") s += v;
      else st[param] += v;
    }
    st.s *= s;
  }
  st.alpha = Math.max(0, Math.min(1, st.alpha));
  return st;
}

export function animCss(a: AnimState): string {
  if (a.s === 1 && a.tx === 0 && a.ty === 0 && a.rot === 0) return "";
  return `translate(${(a.tx * 100).toFixed(3)}%, ${(a.ty * 100).toFixed(3)}%) scale(${a.s.toFixed(4)}) rotate(${a.rot.toFixed(3)}deg)`;
}

/** The extra effects (blur, RGB split, shakes, flashes) the animations add, as ranged effects. */
export function animEffects(anim: ClipAnim | undefined, length: number): ClipEffect[] {
  if (!anim) return [];
  const { din, dout } = windows(anim, length);
  const out: ClipEffect[] = [];
  const clamp = (v: number) => Math.min(length, Math.max(0, v));
  if (din > 0) for (const [kind, amount, a, b] of IN_TABLE[anim.in!.kind].fx ?? []) out.push({ kind, amount, from: clamp(a * din), to: clamp(b * din) });
  if (dout > 0) for (const [kind, amount, a, b] of IN_TABLE[anim.out!.kind].fx ?? []) out.push({ kind, amount, from: clamp(length - b * dout), to: clamp(length - a * dout) });
  const combo = anim.combo && COMBO_TABLE[anim.combo.kind];
  if (combo) for (const [kind, amount, a, b] of combo.fx ?? []) out.push({ kind, amount, from: clamp(a * length), to: clamp(b * length) });
  return out.filter((e) => (e.to ?? 0) - (e.from ?? 0) > 1e-3);
}

export const hasAnim = (anim: ClipAnim | undefined) => !!(anim?.in || anim?.out || anim?.combo);

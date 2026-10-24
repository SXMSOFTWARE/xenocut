// Transitions between adjacent clips on a track. Mirrors `src-tauri/src/transitions.rs`: a
// transition lives on the outgoing clip and is centred on the cut. Built-ins are FFmpeg xfade
// transitions (export) with GLSL ports (preview, see builtins.ts); pack transitions are
// gl-transitions shaders rendered by WebGL in both preview and export.
import type { Clip, ClipTransition, Track } from "../project/types";
import { clipDuration } from "../project/ops";
import { XFADE_GLSL } from "./builtins";

export const ADJACENT_EPS = 0.02;
export const MIN_DURATION = 0.1;
export const MAX_DURATION = 5;
export const DEFAULT_DURATION = 0.6;

export type TransitionCategory = "basic" | "wipe" | "slide" | "shape" | "smooth" | "zoom" | "glitch" | "light" | "motion" | "pattern" | "imported";
export const CATEGORIES: TransitionCategory[] = ["basic", "wipe", "slide", "shape", "smooth", "zoom", "motion", "glitch", "light", "pattern", "imported"];

export interface TransitionDef {
  id: string;
  name: string;
  category: TransitionCategory;
  /** gl-transitions body (built-ins also need XFADE_PRELUDE, see `shaderSource`). */
  glsl: string;
  builtin: boolean;
  fallback?: string;
  duration?: number;
  packId?: string;
  author?: string;
  license?: string;
}

const B = (id: string, name: string, category: TransitionCategory): TransitionDef => ({ id, name, category, glsl: XFADE_GLSL[id], builtin: true });

/** The xfade built-ins, in browser order. Names are English; the UI localises by id. */
export const BUILTINS: TransitionDef[] = [
  B("fade", "Dissolve", "basic"),
  B("fadeblack", "Dip to Black", "basic"),
  B("fadewhite", "Dip to White", "light"),
  B("fadegrays", "Fade Gray", "basic"),
  B("fadefast", "Fast Fade", "basic"),
  B("fadeslow", "Slow Fade", "basic"),
  B("dissolve", "Noise Dissolve", "glitch"),
  B("pixelize", "Pixelate", "glitch"),
  B("wipeleft", "Wipe Left", "wipe"),
  B("wiperight", "Wipe Right", "wipe"),
  B("wipeup", "Wipe Up", "wipe"),
  B("wipedown", "Wipe Down", "wipe"),
  B("wipetl", "Wipe ↖", "wipe"),
  B("wipetr", "Wipe ↗", "wipe"),
  B("wipebl", "Wipe ↙", "wipe"),
  B("wipebr", "Wipe ↘", "wipe"),
  B("slideleft", "Slide Left", "slide"),
  B("slideright", "Slide Right", "slide"),
  B("slideup", "Slide Up", "slide"),
  B("slidedown", "Slide Down", "slide"),
  B("coverleft", "Cover Left", "slide"),
  B("coverright", "Cover Right", "slide"),
  B("coverup", "Cover Up", "slide"),
  B("coverdown", "Cover Down", "slide"),
  B("revealleft", "Reveal Left", "slide"),
  B("revealright", "Reveal Right", "slide"),
  B("revealup", "Reveal Up", "slide"),
  B("revealdown", "Reveal Down", "slide"),
  B("smoothleft", "Smooth Left", "smooth"),
  B("smoothright", "Smooth Right", "smooth"),
  B("smoothup", "Smooth Up", "smooth"),
  B("smoothdown", "Smooth Down", "smooth"),
  B("circleopen", "Circle Open", "shape"),
  B("circleclose", "Circle Close", "shape"),
  B("circlecrop", "Iris", "shape"),
  B("rectcrop", "Box Iris", "shape"),
  B("vertopen", "Doors Open", "shape"),
  B("vertclose", "Doors Close", "shape"),
  B("horzopen", "Blinds Open", "shape"),
  B("horzclose", "Blinds Close", "shape"),
  B("radial", "Clock Wipe", "shape"),
  B("diagtl", "Diagonal ↖", "smooth"),
  B("diagtr", "Diagonal ↗", "smooth"),
  B("diagbl", "Diagonal ↙", "smooth"),
  B("diagbr", "Diagonal ↘", "smooth"),
  B("hlslice", "Slices Left", "pattern"),
  B("hrslice", "Slices Right", "pattern"),
  B("vuslice", "Slices Up", "pattern"),
  B("vdslice", "Slices Down", "pattern"),
  B("hlwind", "Wind Left", "motion"),
  B("hrwind", "Wind Right", "motion"),
  B("vuwind", "Wind Up", "motion"),
  B("vdwind", "Wind Down", "motion"),
  B("squeezeh", "Squeeze", "zoom"),
  B("squeezev", "Squeeze Side", "zoom"),
  B("zoomin", "Zoom In", "zoom"),
];
export const BUILTIN = new Map(BUILTINS.map((d) => [d.id, d]));
export const isXfade = (id: string) => BUILTIN.has(id);

/** The GLSL body to render a clip's transition with (null: nothing renderable). */
export function transitionGlsl(t: ClipTransition): { glsl: string; builtin: boolean } | null {
  if (t.glsl) return { glsl: t.glsl, builtin: false };
  const def = BUILTIN.get(t.id);
  return def ? { glsl: def.glsl, builtin: true } : null;
}

/** Same as transitions.rs: true when the export needs the WebGL render step. */
export const isShader = (t: ClipTransition) => !(isXfade(t.id) && !t.glsl);

export function effectiveDuration(requested: number, a: number, b: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.min(Math.max(requested, 0), MAX_DURATION, a, b);
}

export interface Join {
  from: Clip;
  to: Clip;
  /** Effective duration, seconds; the window is [cut - d/2, cut + d/2]. */
  duration: number;
  cut: number;
  transition: ClipTransition;
}

/** Clips that can carry transitions: visual media clips (not text, not audio). */
const visual = (c: Clip, tracks: Map<string, Track>) => !!c.mediaId && !c.text && tracks.get(c.trackId)?.kind === "video";

/** Active joins per track (mirrors transitions.rs `joins`), keyed by the outgoing clip id. */
export function joins(clips: Clip[], trackList: Track[]): Map<string, Join> {
  const tracks = new Map(trackList.map((t) => [t.id, t]));
  const byTrack = new Map<string, Clip[]>();
  for (const c of clips) {
    if (!visual(c, tracks)) continue;
    const list = byTrack.get(c.trackId) ?? [];
    list.push(c);
    byTrack.set(c.trackId, list);
  }
  const out = new Map<string, Join>();
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], b = list[i + 1];
      const t = a.transition;
      const cut = a.start + clipDuration(a);
      if (!t || Math.abs(b.start - cut) >= ADJACENT_EPS) continue;
      const d = effectiveDuration(t.duration, clipDuration(a), clipDuration(b));
      if (d >= MIN_DURATION - 1e-9) out.set(a.id, { from: a, to: b, duration: d, cut, transition: t });
    }
  }
  return out;
}

/** Adjacent pairs on a track whether or not they have a transition (for the cut buttons). */
export function cuts(clips: Clip[], trackList: Track[]): { from: Clip; to: Clip; cut: number }[] {
  const tracks = new Map(trackList.map((t) => [t.id, t]));
  const list = clips.filter((c) => visual(c, tracks)).sort((a, b) => a.trackId.localeCompare(b.trackId) || a.start - b.start);
  const out: { from: Clip; to: Clip; cut: number }[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i], b = list[i + 1];
    const cut = a.start + clipDuration(a);
    if (a.trackId === b.trackId && Math.abs(b.start - cut) < ADJACENT_EPS) out.push({ from: a, to: b, cut });
  }
  return out;
}

/** The join active at time t on a track (the window is centred on the cut). */
export function joinAt(all: Map<string, Join>, trackId: string, t: number): Join | null {
  for (const j of all.values()) {
    if (j.from.trackId === trackId && t >= j.cut - j.duration / 2 && t < j.cut + j.duration / 2) return j;
  }
  return null;
}

/** Uniform defaults from gl-transitions `uniform <type> name; // = value` lines. */
export interface UniformSpec {
  name: string;
  type: "float" | "int" | "bool" | "vec2" | "vec3" | "vec4" | "ivec2";
  value: number[];
  /** `// @param` comment above, when present. */
  label?: string;
}

export function parseUniforms(glsl: string): UniformSpec[] {
  const out: UniformSpec[] = [];
  const lines = glsl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*uniform\s+(float|int|bool|vec2|vec3|vec4|ivec2)\s+(\w+)\s*;\s*(?:\/\/\s*=\s*(.+))?$/.exec(lines[i]);
    if (!m) continue;
    const [, type, name, def] = m;
    if (name === "progress" || name === "ratio" || name === "resolution") continue;
    const n = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4, ivec2: 2 }[type as UniformSpec["type"]];
    let value = new Array(n).fill(0);
    if (def) {
      const d = def.trim().replace(/;$/, "");
      if (type === "bool") value = [/true/.test(d) ? 1 : 0];
      else {
        const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
        if (nums.length === 1) value = new Array(n).fill(nums[0]);
        else if (nums.length >= n) value = nums.slice(0, n);
      }
    }
    const prev = /^\s*\/\/\s*@param\s+(.+)$/.exec(lines[i - 1] ?? "");
    out.push({ name, type: type as UniformSpec["type"], value, label: prev?.[1]?.trim() });
  }
  return out;
}

/** Reads gl-transitions `// Key: value` header comments. */
export function glslHeader(glsl: string, key: string): string | undefined {
  for (const line of glsl.split("\n").slice(0, 20)) {
    const m = /^\s*\/\/\s*([\w ]+):\s*(.+)$/.exec(line);
    if (m && m[1].trim().toLowerCase() === key.toLowerCase()) return m[2].trim();
  }
  return undefined;
}

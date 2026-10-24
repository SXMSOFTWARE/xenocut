/**
 * Editor themes. A theme is a LAYOUT (where the preview, panels, media bin and timeline sit)
 * plus look tokens (colours, radius, density, type scale). Built-in themes live here; users can
 * tweak one (accent, density, radius, panel side), save it as their own and share it as a pack.
 *
 * Applied on <html>: `data-layout` (desktop only), `data-density` and inline CSS variables.
 * The phone UI takes the colours and density only.
 */
export type LayoutKind = "xenocut" | "modern" | "basic" | "classic";
export type Density = "compact" | "normal" | "comfortable";

export interface ThemeDef {
  id: string;
  name: string;
  layout: LayoutKind;
  density: Density;
  /** Corner radius scale: 0 = square, 1 = the reference roundness. */
  radius: number;
  /** Type scale, 0.85..1.25. */
  fontScale: number;
  /** Main accent; empty = the theme's own accent tokens. */
  accent: string;
  /** Extra CSS custom properties (`--name` -> value). */
  tokens: Record<string, string>;
  /** Where it came from: "builtin", "user" or a pack id. */
  source?: string;
}

export interface ThemeTweaks {
  accent?: string;
  density?: Density;
  radius?: number;
  fontScale?: number;
}

export const LAYOUTS: LayoutKind[] = ["xenocut", "modern", "basic", "classic"];
export const DENSITIES: Density[] = ["compact", "normal", "comfortable"];

/** Solid surfaces shared by the non-glass themes. */
function solid(bg: string, s1: string, s2: string, s3: string, s4: string, line: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "--bg": bg,
    "--bg-raised": s1,
    "--surface-1": s1,
    "--surface-2": s2,
    "--surface-3": s3,
    "--surface-4": s4,
    "--surface-glass": s1,
    "--glass-warm": s1,
    "--glass-warm-border": line,
    "--glass-warm-hi": "none",
    "--glass-btn": "rgba(255, 255, 255, 0.07)",
    "--glass-btn-hover": "rgba(255, 255, 255, 0.13)",
    "--glass-btn-border": line,
    "--hero-bg": bg,
    "--tl-bg": s1,
    "--panel-bg": s1,
    "--line-strong": line,
    ...extra,
  };
}

export const BUILTIN_THEMES: ThemeDef[] = [
  { id: "xenocut", name: "XenoCut", layout: "xenocut", density: "normal", radius: 1, fontScale: 1, accent: "", tokens: {}, source: "builtin" },
  {
    id: "modern",
    name: "Modern",
    layout: "modern",
    density: "normal",
    radius: 0.4,
    fontScale: 1,
    accent: "#4f8cff",
    tokens: solid("#151618", "#1e1f22", "#26272b", "#2f3035", "#3a3b41", "rgba(255, 255, 255, 0.09)"),
    source: "builtin",
  },
  {
    id: "basic",
    name: "Basic",
    layout: "basic",
    density: "comfortable",
    radius: 1.1,
    fontScale: 1.12,
    accent: "#2fc8a8",
    tokens: solid("#14191f", "#1b2229", "#232c35", "#2c3742", "#374451", "rgba(255, 255, 255, 0.1)"),
    source: "builtin",
  },
  {
    id: "classic",
    name: "Classic",
    layout: "classic",
    density: "compact",
    radius: 0.15,
    fontScale: 0.94,
    accent: "#2d8ceb",
    tokens: solid("#1a1a1a", "#232323", "#2b2b2b", "#333333", "#3d3d3d", "rgba(0, 0, 0, 0.55)", { "--line": "rgba(255, 255, 255, 0.05)" }),
    source: "builtin",
  },
];

const HEX = /^#[0-9a-f]{6}$/i;
const TOKEN_NAME = /^--[a-z0-9-]{1,40}$/;
/** Values a pack may set: colours, lengths, gradients. No url(), no escapes, no breaking out. */
const TOKEN_VALUE = /^[a-z0-9 #%(),.+\-/]{1,160}$/i;

export function safeToken(name: string, value: string): boolean {
  return TOKEN_NAME.test(name) && TOKEN_VALUE.test(value) && !/url|expression|image-set|attr/i.test(value);
}

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);

/** Validates untrusted theme data (settings file, pack manifest); null when unusable. */
export function cleanTheme(v: unknown, source?: string): ThemeDef | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(o.id)) return null;
  if (typeof o.name !== "string" || !o.name.trim()) return null;
  const tokens: Record<string, string> = {};
  if (o.tokens && typeof o.tokens === "object") {
    for (const [k, val] of Object.entries(o.tokens as Record<string, unknown>).slice(0, 64)) {
      if (typeof val === "string" && safeToken(k, val)) tokens[k] = val;
    }
  }
  return {
    id: o.id,
    name: o.name.trim().slice(0, 48),
    layout: LAYOUTS.includes(o.layout as LayoutKind) ? (o.layout as LayoutKind) : "xenocut",
    density: DENSITIES.includes(o.density as Density) ? (o.density as Density) : "normal",
    radius: clamp(o.radius, 0, 1.5, 1),
    fontScale: clamp(o.fontScale, 0.85, 1.25, 1),
    accent: typeof o.accent === "string" && HEX.test(o.accent) ? o.accent : "",
    tokens,
    source: source ?? (typeof o.source === "string" ? o.source : undefined),
  };
}

export function cleanTweaks(v: unknown): ThemeTweaks {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const out: ThemeTweaks = {};
  if (typeof o.accent === "string" && HEX.test(o.accent)) out.accent = o.accent;
  if (DENSITIES.includes(o.density as Density)) out.density = o.density as Density;
  if (typeof o.radius === "number") out.radius = clamp(o.radius, 0, 1.5, 1);
  if (typeof o.fontScale === "number") out.fontScale = clamp(o.fontScale, 0.85, 1.25, 1);
  return out;
}

/** The theme with the user's tweaks folded in. */
export function resolveTheme(base: ThemeDef, tweaks: ThemeTweaks): ThemeDef {
  return {
    ...base,
    accent: tweaks.accent ?? base.accent,
    density: tweaks.density ?? base.density,
    radius: tweaks.radius ?? base.radius,
    fontScale: tweaks.fontScale ?? base.fontScale,
  };
}

function mix(hex: string, to: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (to - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Every CSS variable the theme sets (tokens + derived accent/radius/type). */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const vars: Record<string, string> = { ...theme.tokens };
  if (theme.accent) {
    const a = theme.accent;
    vars["--accent-1"] = mix(a, 255, 0.25);
    vars["--accent-2"] = a;
    vars["--accent-3"] = mix(a, 0, 0.25);
    vars["--brand"] = a;
    vars["--theme-accent"] = a;
    vars["--accent-soft"] = rgba(a, 0.18);
    vars["--sel"] = a;
    if (theme.layout !== "xenocut") {
      vars["--accent"] = a;
      vars["--accent-ink"] = "#ffffff";
    }
  }
  const r = theme.radius;
  for (const [k, px] of [["xs", 6], ["sm", 8], ["md", 12], ["lg", 16], ["xl", 20]] as const) vars[`--r-${k}`] = `${Math.round(px * r * 10) / 10}px`;
  vars["--r-scale"] = String(r);
  const f = theme.fontScale;
  for (const [k, px] of [["xs", 11], ["sm", 12], ["md", 13], ["lg", 15], ["xl", 20], ["2xl", 28]] as const) vars[`--fs-${k}`] = `${Math.round(px * f * 10) / 10}px`;
  vars["--font-scale"] = String(f);
  vars["--ui-zoom"] = String((theme.density === "compact" ? 0.92 : theme.density === "comfortable" ? 1.1 : 1) * (f > 1 ? 1 + (f - 1) * 0.5 : 1));
  return vars;
}

let applied: string[] = [];

/** Puts the theme on <html>. `mobile` skips the layout (the phone UI has its own). */
export function applyTheme(theme: ThemeDef, mobile: boolean) {
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  const vars = themeVars(theme);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  root.dataset.layout = mobile ? "xenocut" : theme.layout;
  root.dataset.density = theme.density;
  root.dataset.theme = theme.id;
  // Solid themes (any own surface colours) drop the glass/ambient look on desktop and phone.
  if (theme.tokens["--bg"]) root.dataset.solid = "";
  else delete root.dataset.solid;
}

/** A pack manifest that carries one theme (exported from Settings, installable anywhere). */
export function themePackManifest(theme: ThemeDef, author: string) {
  const id = `theme.${theme.id.replace(/^theme\./, "").replace(/[^a-z0-9._-]/gi, "-").toLowerCase()}`.slice(0, 64);
  const { source: _s, ...entry } = theme;
  return {
    format: "xenocut-pack/1",
    id,
    name: theme.name,
    version: "1.0.0",
    author: author || "XenoCut user",
    license: "CC0-1.0",
    description: `${theme.name} theme (${theme.layout} layout)`,
    themes: [{ ...entry, id: theme.id }],
  };
}

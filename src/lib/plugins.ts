// Plugin packs (see docs/plugins.md and src-tauri/src/plugins.rs): data-only bundles of effect
// presets, clip animations, colour LUTs and text presets. The backend validates and stores
// them; this module keeps the installed list and the catalog in a store and loads LUTs.
import { create } from "zustand";
import { call, log } from "./backend";
import type { ComboDef, EdgeDef } from "../project/anims";
import type { TextStyle } from "../project/text";
import { FONTS } from "../text/fonts";

export interface PackEffect {
  id: string;
  name: string;
  category: string;
  stack: [string, number][];
}
export interface PackAnimation {
  id: string;
  name: string;
  slot: "in" | "out" | "combo";
  spec: EdgeDef | ComboDef;
  duration?: number;
}
export interface PackLut {
  id: string;
  name: string;
  file: string;
}
export interface PackTextPreset {
  id: string;
  name: string;
  style: Partial<TextStyle>;
}
export interface Manifest {
  format: string;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  homepage?: string;
  description: string;
  thumbnail?: string;
  effects?: PackEffect[];
  animations?: PackAnimation[];
  luts?: PackLut[];
  textPresets?: PackTextPreset[];
}
export interface Installed {
  manifest: Manifest;
  enabled: boolean;
  dir: string;
  bytes: number;
}
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  description: string;
  homepage?: string;
  url: string;
  sha256: string;
  bytes: number;
  thumbnail?: string;
  /** What's inside, for badges: counts per kind. */
  contents: { effects?: number; animations?: number; luts?: number; textPresets?: number };
}
export interface Cube {
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: number[];
}

/** Catalog pack thumbnails live next to the index (raw GitHub, allowed in the CSP's img-src). */
export const CATALOG_BASE = "https://raw.githubusercontent.com/sxmsoft/xenocut/main/catalog/";

/** A path inside a pack folder (manifest paths always use "/"). */
export function packFile(pack: Installed, rel: string): string {
  const sep = pack.dir.includes("\\") ? "\\" : "/";
  return pack.dir + sep + rel.split("/").join(sep);
}

interface PluginState {
  installed: Installed[];
  loaded: boolean;
  catalog: CatalogEntry[] | null;
  catalogError: string | null;
  busy: string | null;
  refresh: () => Promise<void>;
  install: (path: string) => Promise<Installed>;
  installFromCatalog: (entry: CatalogEntry) => Promise<Installed>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  loadCatalog: (force?: boolean) => Promise<void>;
}

export const usePlugins = create<PluginState>((set, get) => ({
  installed: [],
  loaded: false,
  catalog: null,
  catalogError: null,
  busy: null,
  refresh: async () => {
    try {
      set({ installed: await call<Installed[]>("plugin_list"), loaded: true });
    } catch (e) {
      log("warn", `plugins: list failed: ${e}`);
      set({ loaded: true });
    }
  },
  install: async (path) => {
    set({ busy: path });
    try {
      const pack = await call<Installed>("plugin_install", { path });
      log("info", `plugins: installed ${pack.manifest.id} ${pack.manifest.version}`);
      await get().refresh();
      return pack;
    } finally {
      set({ busy: null });
    }
  },
  installFromCatalog: async (entry) => {
    set({ busy: entry.id });
    try {
      const pack = await call<Installed>("plugin_install_url", { url: entry.url, sha256: entry.sha256 });
      log("info", `plugins: installed ${pack.manifest.id} from the catalog`);
      await get().refresh();
      return pack;
    } finally {
      set({ busy: null });
    }
  },
  remove: async (id) => {
    await call("plugin_remove", { id });
    await get().refresh();
  },
  setEnabled: async (id, enabled) => {
    await call("plugin_set_enabled", { id, enabled });
    await get().refresh();
  },
  loadCatalog: async (force = false) => {
    if (get().catalog && !force) return;
    set({ catalogError: null });
    try {
      // Fetched by the backend (the webview's CSP only talks to the app itself).
      const json = await call<{ format?: string; packs?: CatalogEntry[] }>("plugin_catalog");
      if (json.format !== "xenocut-catalog/1" || !Array.isArray(json.packs)) throw new Error("unexpected catalog format");
      set({ catalog: json.packs.filter((p) => typeof p.url === "string" && typeof p.id === "string" && /^[0-9a-f]{64}$/i.test(p.sha256)) });
    } catch (e) {
      log("warn", `plugins: catalog failed: ${e}`);
      set({ catalogError: String(e) });
    }
  },
}));

/** Enabled packs with their entries, for the panels. */
export function enabledPacks(list: Installed[]): Installed[] {
  return list.filter((p) => p.enabled);
}

const cubes = new Map<string, Promise<Cube | null>>();
/** A plugin LUT for the preview (cached per path; null if missing or invalid). */
export function loadCube(path: string): Promise<Cube | null> {
  let p = cubes.get(path);
  if (!p) {
    p = call<Cube>("plugin_lut", { path }).catch((e) => {
      log("warn", `plugins: LUT ${path}: ${e}`);
      cubes.delete(path);
      return null;
    });
    cubes.set(path, p);
  }
  return p;
}

/** CPU trilinear lookup (thumbnails); `rgb` 0..1. */
export function applyCube(c: Cube, r: number, g: number, b: number, out: number[]): void {
  const n = c.size;
  const coord = (v: number, i: number) => Math.min(n - 1, Math.max(0, ((v - c.domainMin[i]) / (c.domainMax[i] - c.domainMin[i])) * (n - 1)));
  const x = coord(r, 0), y = coord(g, 1), z = coord(b, 2);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const at = (xi: number, yi: number, zi: number, ch: number) => c.data[(xi + yi * n + zi * n * n) * 3 + ch];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = at(x0, y0, z0, ch) * (1 - fx) + at(x1, y0, z0, ch) * fx;
    const c10 = at(x0, y1, z0, ch) * (1 - fx) + at(x1, y1, z0, ch) * fx;
    const c01 = at(x0, y0, z1, ch) * (1 - fx) + at(x1, y0, z1, ch) * fx;
    const c11 = at(x0, y1, z1, ch) * (1 - fx) + at(x1, y1, z1, ch) * fx;
    out[ch] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }
}

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ENUMS: Record<string, readonly string[]> = { background: ["none", "box", "pill", "band"], align: ["left", "center", "right"] };
const RANGES: Record<string, [number, number]> = {
  weight: [100, 900],
  size: [8, 400],
  stroke: [0, 40],
  shadow: [0, 1],
  glow: [0, 1],
  bgOpacity: [0, 1],
  x: [0, 1],
  y: [0, 1],
  width: [0.1, 1],
  spacing: [-0.2, 1],
  lineHeight: [0.6, 3],
};

/** Only known text style keys with valid values survive (packs are untrusted data): fonts must be
 *  bundled, enums known, colours `#rrggbb[aa]`, numbers clamped to what the editor offers. */
export function sanitizeTextStyle(style: Record<string, unknown>, base: TextStyle): Partial<TextStyle> {
  const out: Record<string, unknown> = {};
  const fonts = new Set(FONTS.map((f) => f.id as string));
  for (const [k, v] of Object.entries(style)) {
    if (!(k in base)) continue;
    const cur = (base as unknown as Record<string, unknown>)[k];
    if (k === "font") {
      if (typeof v === "string" && fonts.has(v)) out[k] = v;
    } else if (ENUMS[k]) {
      if (typeof v === "string" && ENUMS[k].includes(v)) out[k] = v;
    } else if (k === "color2") {
      if (v === null || (typeof v === "string" && COLOR.test(v))) out[k] = v;
    } else if (typeof cur === "string") {
      if (typeof v === "string" && COLOR.test(v)) out[k] = v;
    } else if (typeof cur === "number") {
      if (typeof v === "number" && Number.isFinite(v)) {
        const [lo, hi] = RANGES[k] ?? [-1e6, 1e6];
        out[k] = Math.min(hi, Math.max(lo, v));
      }
    } else if (typeof cur === "boolean" && typeof v === "boolean") out[k] = v;
  }
  return out as Partial<TextStyle>;
}

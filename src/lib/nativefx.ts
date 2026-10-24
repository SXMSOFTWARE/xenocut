// Native effect plug-ins (OpenFX bundles, frei0r libraries) on desktop Linux. They run in the
// isolated `xenocut --fxhost` process (src-tauri/src/fxhost.rs); this module lists them, turns
// their parameter descriptions into a UI schema and sends preview frames through them.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { call, isTauri } from "./backend";
import type { Clip, MediaItem, NativeFx } from "../project/types";
import { toast } from "../store/toast";
import { t } from "../i18n";

let listening = false;
/** Effect-host notes (a plug-in failed or crashed and was skipped) become toasts. */
function listenNotes() {
  if (listening || !isTauri) return;
  listening = true;
  void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("fx-native-note", (e) => toast(t("nfx.note", { text: e.payload }), "error")));
}

export interface NativePlugin {
  id: string;
  kind: "ofx" | "frei0r";
  label: string;
  group: string;
  description: string;
  source: string;
}

export interface NativeCatalog {
  available: boolean;
  plugins: NativePlugin[];
  blocked: Record<string, string>;
  dirs: string[];
  error?: string;
}

/** One control in the generated parameter UI. */
export interface NativeParam {
  name: string;
  label: string;
  hint: string;
  kind: "bool" | "number" | "choice" | "color" | "string";
  /** Number of components (number: 1..3, colour: 3 or 4). */
  dims: number;
  int: boolean;
  min: number;
  max: number;
  choices: string[];
  /** Default value as stored in `NativeFx.params`. */
  def: number[] | string;
  /** Heading of the OpenFX group it sits in ("" for top level). */
  group: string;
}

interface NativeState {
  catalog: NativeCatalog | null;
  loading: boolean;
  load: (rescan?: boolean) => Promise<NativeCatalog | null>;
  unblock: () => Promise<void>;
}

export const useNativeFx = create<NativeState>((set, get) => ({
  catalog: null,
  loading: false,
  load: async (rescan = false) => {
    if (get().loading) return get().catalog;
    if (get().catalog && !rescan) return get().catalog;
    listenNotes();
    set({ loading: true });
    try {
      const catalog = await call<NativeCatalog>("fx_native_catalog", { rescan });
      set({ catalog });
      if (rescan) described.clear();
      return catalog;
    } catch (e) {
      const catalog: NativeCatalog = { available: false, plugins: [], blocked: {}, dirs: [], error: String(e) };
      set({ catalog });
      return catalog;
    } finally {
      set({ loading: false });
    }
  },
  unblock: async () => {
    set({ loading: true });
    try {
      described.clear();
      set({ catalog: await call<NativeCatalog>("fx_native_unblock") });
    } finally {
      set({ loading: false });
    }
  },
}));

const described = new Map<string, Promise<NativeParam[]>>();

/** The editable parameters of plug-in `id` (cached). */
export function describeNative(id: string): Promise<NativeParam[]> {
  let job = described.get(id);
  if (!job) {
    job = call<{ params: RawParam[] }>("fx_native_describe", { id }).then((d) => normalise(id, d.params ?? []));
    job.catch(() => described.delete(id));
    described.set(id, job);
  }
  return job;
}

interface RawParam {
  name: string;
  type: string;
  label?: string;
  hint?: string;
  parent?: string;
  secret?: boolean;
  default?: number[] | string | null;
  min?: number[];
  max?: number[];
  displayMin?: number[];
  displayMax?: number[];
  choices?: string[];
  doubleType?: string;
}

const finite = (v: number | undefined, lim = 1e6) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < lim;

function normalise(id: string, raw: RawParam[]): NativeParam[] {
  const frei0r = id.startsWith("frei0r:");
  const groups = new Map(raw.filter((p) => p.type === "OfxParamTypeGroup").map((p) => [p.name, p.label || p.name]));
  const out: NativeParam[] = [];
  for (const p of raw) {
    if (p.secret) continue;
    const base = { name: p.name, label: p.label || p.name, hint: p.hint ?? "", group: groups.get(p.parent ?? "") ?? "", int: false, min: 0, max: 1, choices: [] as string[] };
    const nums = Array.isArray(p.default) ? p.default : [];
    if (frei0r) {
      // frei0r: values are 0..1 by convention (positions too).
      if (p.type === "bool") out.push({ ...base, kind: "bool", dims: 1, def: [nums[0] ?? 0] });
      else if (p.type === "double") out.push({ ...base, kind: "number", dims: 1, def: [nums[0] ?? 0] });
      else if (p.type === "position") out.push({ ...base, kind: "number", dims: 2, def: [nums[0] ?? 0.5, nums[1] ?? 0.5] });
      else if (p.type === "color") out.push({ ...base, kind: "color", dims: 3, def: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0] });
      else if (p.type === "string") out.push({ ...base, kind: "string", dims: 1, def: typeof p.default === "string" ? p.default : "" });
      continue;
    }
    const range = (dims: number, int: boolean) => {
      const lo = [p.displayMin?.[0], p.min?.[0]].find((v) => finite(v));
      const hi = [p.displayMax?.[0], p.max?.[0]].find((v) => finite(v));
      const d = nums[0] ?? 0;
      const min = lo ?? Math.min(0, d);
      const max = hi !== undefined && hi > min ? hi : Math.max(min + (int ? 10 : 1), d * 2 || 1);
      return { ...base, kind: "number" as const, dims, int, min, max, def: nums.slice(0, dims).concat(Array(Math.max(0, dims - nums.length)).fill(0)) };
    };
    switch (p.type) {
      case "OfxParamTypeBoolean":
        out.push({ ...base, kind: "bool", dims: 1, def: [nums[0] ?? 0] });
        break;
      case "OfxParamTypeChoice":
        if (p.choices?.length) out.push({ ...base, kind: "choice", dims: 1, choices: p.choices, def: [nums[0] ?? 0] });
        break;
      case "OfxParamTypeInteger":
        out.push(range(1, true));
        break;
      case "OfxParamTypeInteger2D":
        out.push(range(2, true));
        break;
      case "OfxParamTypeInteger3D":
        out.push(range(3, true));
        break;
      case "OfxParamTypeDouble":
        out.push(range(1, false));
        break;
      case "OfxParamTypeDouble2D":
        out.push(range(2, false));
        break;
      case "OfxParamTypeDouble3D":
        out.push(range(3, false));
        break;
      case "OfxParamTypeRGB":
      case "OfxParamTypeRGBA": {
        const dims = p.type === "OfxParamTypeRGB" ? 3 : 4;
        out.push({ ...base, kind: "color", dims, def: [0, 1, 2, 3].slice(0, dims).map((i) => nums[i] ?? (i === 3 ? 1 : 0)) });
        break;
      }
      case "OfxParamTypeString":
        out.push({ ...base, kind: "string", dims: 1, def: typeof p.default === "string" ? p.default : "" });
        break;
      // Pages, groups, buttons and custom parameters have no value to edit here.
    }
  }
  return out;
}

export const enabledNative = (clip: Clip) => (clip.nativeFx ?? []).filter((f) => f.enabled !== false);

/** Size of `media` fitted into the project canvas (matches fit_size in fxbake.rs). */
export function fitSize(media: MediaItem, outW: number, outH: number): { w: number; h: number } {
  const mw = media.width > 0 && media.height > 0 ? media.width : outW;
  const mh = media.width > 0 && media.height > 0 ? media.height : outH;
  const s = Math.min(outW / mw, outH / mh);
  const even = (v: number) => (Math.max(2, Math.round(v)) + 1) & ~1;
  return { w: even(mw * s), h: even(mh * s) };
}

export interface PreviewRequest {
  key: string;
  chain: NativeFx[];
  w: number;
  h: number;
  fullW: number;
  fullH: number;
  time: number;
  fps: number;
}

/** Run one RGBA frame through `req.chain` in the effect host. */
export async function renderNativeFrame(req: PreviewRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
  const head = new TextEncoder().encode(JSON.stringify({ ...req, chain: req.chain.map((f) => ({ ...f, enabled: f.enabled !== false })) }));
  const body = new Uint8Array(4 + head.length + rgba.length);
  new DataView(body.buffer).setUint32(0, head.length, true);
  body.set(head, 4);
  body.set(rgba, 4 + head.length);
  if (import.meta.env.DEV && !isTauri) {
    const { invoke: devInvoke } = await import("../dev/devBackend");
    return new Uint8ClampedArray(await devInvoke<ArrayBuffer>("fx_native_preview", { body }));
  }
  const out = await invoke<ArrayBuffer>("fx_native_preview", body);
  return new Uint8ClampedArray(out);
}

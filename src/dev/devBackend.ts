// DEV ONLY — browser stand-in for the Tauri backend, used to take design screenshots with
// `vite dev` in a normal browser. It is loaded through a dynamic import guarded by
// `import.meta.env.DEV` in lib/backend.ts, so it is never part of a production bundle.
//
// Media data is real: `cargo run --example harness -- assets …` probes files and renders
// thumbnails/filmstrips/waveforms with the app's own Rust code and writes a manifest; point
// VITE_XENOCUT_FIXTURES at that manifest. Anything that needs native work (export, stem
// separation, downloads) reports that the desktop app is required.
import type { FileFilter } from "../lib/backend";
import type { MediaAssets, ProbeInfo } from "../project/types";

interface Manifest {
  items: ProbeInfo[];
  assets: Record<string, MediaAssets>;
}

let manifest: Promise<Manifest> | null = null;
function fixtures(): Promise<Manifest> {
  const path = import.meta.env.VITE_XENOCUT_FIXTURES as string | undefined;
  if (!path) return Promise.resolve({ items: [], assets: {} });
  manifest ??= fetch(`/@fs${path}`).then((r) => r.json() as Promise<Manifest>);
  return manifest;
}

const KEY = "xenocut-dev:";
const read = <T,>(k: string): T | null => {
  const raw = localStorage.getItem(KEY + k);
  return raw ? (JSON.parse(raw) as T) : null;
};
const write = (k: string, v: unknown) => localStorage.setItem(KEY + k, JSON.stringify(v));

const needsDesktop = () => Promise.reject(new Error("Bu işlem masaüstü uygulamasını gerektirir (dev tarayıcı modu)."));

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const m = await fixtures();
  const known = new Set(m.items.map((i) => i.path));
  const result = await (async (): Promise<unknown> => {
    switch (command) {
      case "app_info":
        return { os: "linux", version: "dev", defaultOutputDir: "/home/enes/Videos/XenoCut", defaultProjectDir: "/home/enes/Videos/XenoCut/Projects" };
      case "store_read":
        return read(`store:${args.name}`);
      case "store_write":
        return write(`store:${args.name}`, args.value);
      case "paths_exist":
        return (args.paths as string[]).map((p) => known.has(p) || read(`project:${p}`) !== null);
      case "project_new_path":
        return `${args.dir}/${String(args.name).replace(/[\\/:*?"<>|]+/g, "_")}.xcut`;
      case "project_save":
        return write(`project:${args.path}`, args.project);
      case "project_load": {
        const p = read(`project:${args.path}`);
        if (!p) throw new Error("not found");
        return p;
      }
      case "media_probe": {
        const paths = args.paths as string[];
        return { items: m.items.filter((i) => paths.includes(i.path)), errors: paths.filter((p) => !known.has(p)).map((p) => `${p}: unsupported in dev mode`) };
      }
      case "media_assets":
        return m.assets[args.path as string] ?? { thumb: null, strip: null, stripCount: 0, stripFrameW: 96, stripFrameH: 54, wave: null };
      case "cache_info":
        return { bytes: 18_400_000, path: "/home/enes/.cache/xenocut" };
      case "cache_clear":
        return null;
      case "model_status":
        return { installed: false, bytes: 0, path: "/home/enes/.local/share/xenocut/audio/models/UVR-MDX-NET-Voc_FT.onnx", name: "UVR-MDX-NET-Voc_FT.onnx" };
      case "export_cancel":
      case "audio_cancel":
        return null;
      default:
        return needsDesktop();
    }
  })();
  return result as T;
}

export async function listen<T>(_event: string, _handler: (payload: T) => void): Promise<() => void> {
  return () => {};
}

/** Simulates the user picking every fixture that matches the filter. */
export async function pickFiles(filters: FileFilter[], multiple: boolean): Promise<string[]> {
  const m = await fixtures();
  const exts = new Set(filters.flatMap((f) => f.extensions));
  const hits = m.items.map((i) => i.path).filter((p) => exts.has(p.split(".").pop()!.toLowerCase()));
  return multiple ? hits : hits.slice(0, 1);
}

export async function pickFolder(): Promise<string | null> {
  return null;
}

export async function pickSavePath(defaultPath: string): Promise<string | null> {
  return defaultPath;
}

// The only place the UI talks to the Rust side. In the desktop app every call is a Tauri
// command. In a plain browser during `vite dev` (used for design screenshots only) calls are
// routed to `src/dev/devBackend.ts`; that module is never part of a production build.
import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { MediaAssets, MediaKind, ProbeInfo, Project } from "../project/types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type DevBackend = typeof import("../dev/devBackend");
let devBackend: Promise<DevBackend> | null = null;
function dev(): Promise<DevBackend> {
  if (!import.meta.env.DEV) throw new Error("XenoCut needs the desktop app for this.");
  devBackend ??= import("../dev/devBackend");
  return devBackend;
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) return tauriInvoke<T>(command, args);
  return (await dev()).invoke<T>(command, args);
}

interface MediaTransport {
  base: string | null;
  logPath: string | null;
  autotest: string | null;
}

/** Filled once at boot by `initBackend()`. */
export const transport: MediaTransport = { base: null, logPath: null, autotest: null };

export async function initBackend(): Promise<void> {
  if (!isTauri) return;
  try {
    Object.assign(transport, await tauriInvoke<MediaTransport>("media_transport"));
  } catch (error) {
    console.error("media_transport failed", error);
  }
  log("info", `media transport: ${transport.base ? "http loopback" : "asset protocol"}; ua=${navigator.userAgent}`);
}

/** Append a line to the app log file (and the console). Never throws. */
export function log(level: "info" | "warn" | "error" | "autotest", message: string): void {
  (level === "error" ? console.error : console.log)(`[${level}] ${message}`);
  if (isTauri) void tauriInvoke("client_log", { level, message }).catch(() => {});
}

/** Playable URL for a local file. Desktop/Android: the loopback media server (Range-capable). */
export function fileSrc(path: string): string {
  if (isTauri) return transport.base ? transport.base + encodeURIComponent(path) : convertFileSrc(path);
  if (import.meta.env.DEV) return `/@fs${path.startsWith("/") ? "" : "/"}${path}`;
  return path;
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (isTauri) {
    const { listen: tauriListen } = await import("@tauri-apps/api/event");
    return tauriListen<T>(event, (e) => handler(e.payload));
  }
  return (await dev()).listen<T>(event, handler);
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export const VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts", "m2ts", "3gp", "wmv", "flv"];
export const AUDIO_EXT = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"];
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"];

export async function pickFiles(filters: FileFilter[], multiple = true): Promise<string[]> {
  if (!isTauri) return (await dev()).pickFiles(filters, multiple);
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple, directory: false, filters });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri) return (await dev()).pickFolder();
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, defaultPath });
  return typeof picked === "string" ? picked : null;
}

export async function pickSavePath(defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  if (!isTauri) return (await dev()).pickSavePath(defaultPath);
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters });
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/** Native file drops onto the window (desktop only). */
export async function onFileDrop(handler: (paths: string[], position: { x: number; y: number }) => void, onHover?: (over: boolean) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "over" || payload.type === "enter") onHover?.(true);
    else if (payload.type === "leave") onHover?.(false);
    else if (payload.type === "drop") {
      onHover?.(false);
      const ratio = window.devicePixelRatio || 1;
      handler(payload.paths, { x: payload.position.x / ratio, y: payload.position.y / ratio });
    }
  });
}

// ---- typed commands ----

export interface AppInfo {
  os: string;
  version: string;
  defaultOutputDir: string;
  defaultProjectDir: string;
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  storeRead: <T>(name: "settings" | "recent") => call<T | null>("store_read", { name }),
  storeWrite: (name: "settings" | "recent", value: unknown) => call<void>("store_write", { name, value }),
  pathsExist: (paths: string[]) => call<boolean[]>("paths_exist", { paths }),
  projectNewPath: (dir: string, name: string) => call<string>("project_new_path", { dir, name }),
  projectSave: (path: string, project: Project) => call<void>("project_save", { path, project }),
  projectLoad: (path: string) => call<Project>("project_load", { path }),
  mediaProbe: (paths: string[]) => call<{ items: ProbeInfo[]; errors: string[] }>("media_probe", { paths }),
  mediaAssets: (path: string, kind: MediaKind, duration: number, hasAudio: boolean) =>
    call<MediaAssets>("media_assets", { path, kind, duration, hasAudio }),
  cacheInfo: () => call<{ bytes: number; path: string }>("cache_info"),
  cacheClear: () => call<void>("cache_clear"),
  exportStart: (project: Project, options: ExportOptions) => call<{ path: string; bytes: number }>("export_start", { project, options }),
  exportCancel: () => call<void>("export_cancel"),
  modelStatus: () => call<{ installed: boolean; bytes: number; path: string; name: string }>("model_status"),
  modelDownload: () => call<void>("model_download"),
  modelDelete: () => call<void>("model_delete"),
  separateStems: (inputPath: string) =>
    call<{ vocalsPath: string; instrumentalPath: string; message: string }>("audio_separate_stems", { inputPath }),
  importMusic: (localPath: string) => call<{ musicPath: string; message: string }>("audio_import_music", { localPath }),
  mixRender: (request: MixRequest) => call<{ outputPath: string; message: string }>("audio_mix_render", { request }),
  audioCancel: () => call<void>("audio_cancel"),
  mediaAllow: (paths: string[]) => (isTauri ? call<void>("media_allow", { paths }) : Promise.resolve()),
};

export interface MixRequest {
  videoPath: string;
  vocalsPath: string;
  musicPath: string;
  vocalGain: number;
  musicGain: number;
  musicOffset: number;
  loopMusic: boolean;
  fadeIn: number;
  fadeOut: number;
  videoDuration: number;
  outputPath?: string;
}

export interface AudioProgress {
  step: number;
  progress: number;
  message: string;
  done: boolean;
}

export interface ExportOptions {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  quality: "fast" | "balanced" | "high";
}

export interface ProgressEvent {
  progress: number;
  message: string;
}

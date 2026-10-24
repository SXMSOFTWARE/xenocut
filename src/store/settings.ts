import { create } from "zustand";
import { api, type AppInfo } from "../lib/backend";

export type Language = "tr" | "en";

export interface Settings {
  language: Language;
  outputDir: string;
  projectDir: string;
  performanceMode: boolean;
  /** Play a 540p FFmpeg copy in the preview instead of the original (exports use the original). */
  previewProxy: boolean;
  autosave: boolean;
  /** Whisper model for automatic subtitles. */
  subtitleModel: SubtitleModel;
  /** ISO 639-1 code or "auto". */
  subtitleLanguage: string;
  /** Text preset new subtitles get. */
  subtitleStyle: string;
}

export type SubtitleModel = "tiny" | "base" | "small";

const KEYS: (keyof Settings)[] = ["language", "outputDir", "projectDir", "performanceMode", "previewProxy", "autosave", "subtitleModel", "subtitleLanguage", "subtitleStyle"];

interface SettingsState extends Settings {
  ready: boolean;
  info: AppInfo | null;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

function apply(settings: Settings) {
  const root = document.documentElement;
  root.classList.toggle("perf", settings.performanceMode);
  root.lang = settings.language;
}

export const useSettings = create<SettingsState>((set, get) => ({
  language: "tr",
  outputDir: "",
  projectDir: "",
  performanceMode: true,
  previewProxy: false,
  autosave: true,
  subtitleModel: "base",
  subtitleLanguage: "auto",
  subtitleStyle: "subtitle",
  ready: false,
  info: null,
  load: async () => {
    const info = await api.appInfo();
    const saved = (await api.storeRead<Partial<Settings>>("settings").catch(() => null)) ?? {};
    const settings: Settings = {
      language: saved.language ?? "tr",
      outputDir: saved.outputDir || info.defaultOutputDir,
      projectDir: saved.projectDir || info.defaultProjectDir,
      // WebKitGTK paints translucency in software, so Linux starts in performance mode.
      performanceMode: saved.performanceMode ?? info.os === "linux",
      // Linux WebKitGTK paints 1080p frames slowly; the 540p copy measured 45 -> 60 fps there.
      previewProxy: saved.previewProxy ?? info.os === "linux",
      autosave: saved.autosave ?? true,
      subtitleModel: saved.subtitleModel === "tiny" || saved.subtitleModel === "small" ? saved.subtitleModel : "base",
      subtitleLanguage: typeof saved.subtitleLanguage === "string" ? saved.subtitleLanguage : "auto",
      subtitleStyle: typeof saved.subtitleStyle === "string" ? saved.subtitleStyle : "subtitle",
    };
    apply(settings);
    set({ ...settings, info, ready: true });
  },
  update: (patch) => {
    const next = { ...get(), ...patch };
    const settings = Object.fromEntries(KEYS.map((k) => [k, next[k]])) as unknown as Settings;
    apply(settings);
    set(settings);
    void api.storeWrite("settings", settings);
  },
}));

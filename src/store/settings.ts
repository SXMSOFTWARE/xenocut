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
}

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
      previewProxy: saved.previewProxy ?? false,
      autosave: saved.autosave ?? true,
    };
    apply(settings);
    set({ ...settings, info, ready: true });
  },
  update: (patch) => {
    const { language, outputDir, projectDir, performanceMode, previewProxy, autosave } = { ...get(), ...patch };
    const settings: Settings = { language, outputDir, projectDir, performanceMode, previewProxy, autosave };
    apply(settings);
    set(settings);
    void api.storeWrite("settings", settings);
  },
}));

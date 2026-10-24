import { create } from "zustand";
import { api, type AppInfo } from "../lib/backend";
import { cleanTheme, cleanTweaks, type ThemeDef, type ThemeTweaks } from "../themes";

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
  /** Editor layout: which side the tool panel floats on. */
  panelSide: "right" | "left";
  /** Tool panel width in px; 0 = the reference width. */
  panelWidth: number;
  /** Timeline height as a fraction of the editor hero; 0 = fit the tracks. */
  timelineFrac: number;
  /** Keyboard shortcut overrides: action id -> combos (see `editor/shortcuts.ts`). */
  shortcuts: Record<string, string[]>;
  /** Editor theme id (built-in, user or pack). */
  theme: string;
  /** The user's tweaks on top of the chosen theme. */
  themeTweaks: ThemeTweaks;
  /** Themes the user saved. */
  userThemes: ThemeDef[];
}

export type SubtitleModel = "tiny" | "base" | "small";

const KEYS: (keyof Settings)[] = ["language", "outputDir", "projectDir", "performanceMode", "previewProxy", "autosave", "subtitleModel", "subtitleLanguage", "subtitleStyle", "panelSide", "panelWidth", "timelineFrac", "shortcuts", "theme", "themeTweaks", "userThemes"];

interface SettingsState extends Settings {
  ready: boolean;
  info: AppInfo | null;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

export const PANEL_W = { min: 260, max: 520 };
export const TIMELINE_FRAC = { min: 0.18, max: 0.7 };

export function clampPanelWidth(w: unknown): number {
  const n = typeof w === "number" && Number.isFinite(w) ? Math.round(w) : 0;
  return n <= 0 ? 0 : Math.min(PANEL_W.max, Math.max(PANEL_W.min, n));
}

export function clampTimelineFrac(f: unknown): number {
  const n = typeof f === "number" && Number.isFinite(f) ? f : 0;
  return n <= 0 ? 0 : Math.min(TIMELINE_FRAC.max, Math.max(TIMELINE_FRAC.min, +n.toFixed(3)));
}

function cleanShortcuts(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [k, combos] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(combos)) out[k] = combos.filter((c): c is string => typeof c === "string" && c.length > 0).slice(0, 4);
  }
  return out;
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
  panelSide: "right",
  panelWidth: 0,
  timelineFrac: 0,
  shortcuts: {},
  theme: "xenocut",
  themeTweaks: {},
  userThemes: [],
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
      panelSide: saved.panelSide === "left" ? "left" : "right",
      panelWidth: clampPanelWidth(saved.panelWidth),
      timelineFrac: clampTimelineFrac(saved.timelineFrac),
      shortcuts: cleanShortcuts(saved.shortcuts),
      theme: typeof saved.theme === "string" ? saved.theme : "xenocut",
      themeTweaks: cleanTweaks(saved.themeTweaks),
      userThemes: Array.isArray(saved.userThemes) ? saved.userThemes.slice(0, 32).map((t) => cleanTheme(t, "user")).filter((t): t is ThemeDef => t !== null) : [],
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

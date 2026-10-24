// Text clips: titles, subtitles and lyric lines. The model is plain data; drawing lives in
// `src/text/render.ts` and is shared by the live preview and the export (WYSIWYG).
import type { FontId } from "../text/fonts";

export type TextRole = "title" | "subtitle" | "lyric";
export type AnimIn = "none" | "fade" | "rise" | "drop" | "slideLeft" | "slideRight" | "pop" | "zoom" | "typewriter" | "words" | "spin" | "bounce" | "flyUp" | "stretch" | "wordsRise" | "glitch";
export type AnimOut = "none" | "fade" | "rise" | "sink" | "slideLeft" | "slideRight" | "pop" | "zoom" | "spin" | "flyUp" | "stretch" | "erase" | "glitch";
export type Emphasis = "none" | "pulse" | "shake" | "wave" | "karaoke" | "flicker" | "bounce" | "swing" | "heartbeat" | "breathe" | "jitter" | "rainbow";
export type TextBackground = "none" | "box" | "pill" | "band";
export type TextAlign = "left" | "center" | "right";

export interface TextStyle {
  font: FontId;
  weight: number;
  italic: boolean;
  uppercase: boolean;
  /** Font size in px on a 1080 px short side; scales with the canvas. */
  size: number;
  color: string;
  /** Second colour for a top-to-bottom gradient fill; null = solid. */
  color2: string | null;
  /** Karaoke / highlight colour. */
  highlight: string;
  strokeColor: string;
  /** Outline width, px on a 1080 px short side. 0 = none. */
  stroke: number;
  /** Drop shadow strength 0..1. */
  shadow: number;
  /** Neon glow strength 0..1 (in the fill colour). */
  glow: number;
  background: TextBackground;
  bgColor: string;
  bgOpacity: number;
  align: TextAlign;
  /** Centre of the text block, 0..1 of the canvas. */
  x: number;
  y: number;
  /** Maximum line width, 0..1 of the canvas width. */
  width: number;
  /** Letter spacing in em. */
  spacing: number;
  lineHeight: number;
}

export interface TextAnim {
  in: AnimIn;
  out: AnimOut;
  /** Seconds. */
  inDur: number;
  outDur: number;
  /** Runs for the whole clip. */
  emphasis: Emphasis;
}

export interface TextContent {
  content: string;
  role: TextRole;
  /** Preset id the style started from (UI only). */
  preset: string;
  style: TextStyle;
  anim: TextAnim;
  /** BCP 47 language of `content` (subtitles); casing follows it. Unset: the UI language. */
  lang?: string;
}

export const BASE_STYLE: TextStyle = {
  font: "inter",
  weight: 800,
  italic: false,
  uppercase: false,
  size: 84,
  color: "#ffffff",
  color2: null,
  highlight: "#ffb347",
  strokeColor: "#000000",
  stroke: 0,
  shadow: 0.5,
  glow: 0,
  background: "none",
  bgColor: "#000000",
  bgOpacity: 0.55,
  align: "center",
  x: 0.5,
  y: 0.5,
  width: 0.84,
  spacing: 0,
  lineHeight: 1.15,
};

export const BASE_ANIM: TextAnim = { in: "fade", out: "fade", inDur: 0.35, outDur: 0.3, emphasis: "none" };

export interface TextPreset {
  id: string;
  /** i18n key suffix: `text.preset.<id>`. */
  role: TextRole;
  style: Partial<TextStyle>;
  anim: Partial<TextAnim>;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: "clean", role: "title", style: {}, anim: {} },
  {
    id: "headline",
    role: "title",
    style: { font: "montserrat", weight: 800, italic: true, uppercase: true, size: 96, stroke: 7, shadow: 0.35 },
    anim: { in: "pop", out: "zoom", inDur: 0.4, outDur: 0.25 },
  },
  {
    id: "cinema",
    role: "title",
    style: { font: "playfair", weight: 700, size: 88, spacing: 0.06, shadow: 0.25 },
    anim: { in: "fade", out: "fade", inDur: 0.9, outDur: 0.8 },
  },
  {
    id: "neon",
    role: "title",
    style: { font: "montserrat", weight: 700, uppercase: true, size: 92, color: "#ff7ce6", glow: 1, shadow: 0, spacing: 0.04 },
    anim: { in: "fade", out: "fade", emphasis: "flicker" },
  },
  {
    id: "impact",
    role: "title",
    style: { font: "anton", weight: 400, uppercase: true, size: 124, color: "#ffd400", stroke: 9, shadow: 0.45 },
    anim: { in: "zoom", out: "pop", inDur: 0.3, outDur: 0.2, emphasis: "shake" },
  },
  {
    id: "sunset",
    role: "title",
    style: { font: "bebas", weight: 400, size: 150, color: "#ffd36b", color2: "#ff5e3a", spacing: 0.04, shadow: 0.4 },
    anim: { in: "rise", out: "fade", inDur: 0.5 },
  },
  {
    id: "lowerThird",
    role: "title",
    style: { font: "oswald", weight: 600, uppercase: true, size: 58, background: "band", bgColor: "#ff5e3a", bgOpacity: 0.92, shadow: 0, align: "left", x: 0.3, y: 0.83, width: 0.5, spacing: 0.04 },
    anim: { in: "slideRight", out: "slideLeft", inDur: 0.45, outDur: 0.35 },
  },
  {
    id: "handwritten",
    role: "title",
    style: { font: "caveat", weight: 700, size: 116, shadow: 0.4 },
    anim: { in: "typewriter", out: "fade", inDur: 1.0 },
  },
  {
    id: "comic",
    role: "title",
    style: { font: "bangers", weight: 400, size: 120, color: "#ffe14d", stroke: 9, shadow: 0.5, spacing: 0.03 },
    anim: { in: "pop", out: "pop", inDur: 0.35, outDur: 0.25, emphasis: "wave" },
  },
  {
    id: "glitchTitle",
    role: "title",
    style: { font: "oswald", weight: 700, uppercase: true, size: 110, color: "#e8fbff", stroke: 0, shadow: 0.3, glow: 0.45, spacing: 0.08 },
    anim: { in: "glitch", out: "glitch", inDur: 0.5, outDur: 0.35, emphasis: "jitter" },
  },
  {
    id: "rainbowPop",
    role: "title",
    style: { font: "bangers", weight: 400, size: 128, stroke: 8, strokeColor: "#1b1030", shadow: 0.4, spacing: 0.03 },
    anim: { in: "bounce", out: "pop", inDur: 0.8, outDur: 0.25, emphasis: "rainbow" },
  },
  {
    id: "loveNote",
    role: "title",
    style: { font: "caveat", weight: 700, size: 124, color: "#ff6b9a", glow: 0.5, shadow: 0.2 },
    anim: { in: "pop", out: "fade", inDur: 0.45, outDur: 0.4, emphasis: "heartbeat" },
  },
  {
    id: "spinTitle",
    role: "title",
    style: { font: "anton", weight: 400, uppercase: true, size: 118, color: "#ffffff", color2: "#7cc8ff", stroke: 6, strokeColor: "#0b1a33", shadow: 0.35 },
    anim: { in: "spin", out: "spin", inDur: 0.55, outDur: 0.4 },
  },
  {
    id: "storyTitle",
    role: "title",
    style: { font: "bebas", weight: 400, size: 140, color: "#ffffff", spacing: 0.12, shadow: 0.3 },
    anim: { in: "wordsRise", out: "flyUp", inDur: 0.8, outDur: 0.45, emphasis: "breathe" },
  },
  {
    id: "stretchBanner",
    role: "title",
    style: { font: "montserrat", weight: 800, uppercase: true, size: 70, background: "pill", bgColor: "#111111", bgOpacity: 0.85, color: "#ffd400", shadow: 0, spacing: 0.05 },
    anim: { in: "stretch", out: "stretch", inDur: 0.45, outDur: 0.3, emphasis: "swing" },
  },
  {
    id: "subtitle",
    role: "subtitle",
    style: { weight: 600, size: 46, shadow: 0, background: "box", bgOpacity: 0.6, y: 0.88, width: 0.8, lineHeight: 1.2 },
    anim: { in: "fade", out: "fade", inDur: 0.12, outDur: 0.12 },
  },
  {
    id: "captionPop",
    role: "subtitle",
    style: { font: "montserrat", weight: 800, uppercase: true, size: 64, stroke: 7, shadow: 0.4, highlight: "#ffe14d", y: 0.72, width: 0.7 },
    anim: { in: "words", out: "none", inDur: 0.3, outDur: 0, emphasis: "karaoke" },
  },
  {
    id: "lyric",
    role: "lyric",
    style: { size: 70, shadow: 0.6, highlight: "#ffb347", y: 0.8, width: 0.8, color: "#ffffff" },
    anim: { in: "rise", out: "fade", inDur: 0.3, outDur: 0.25, emphasis: "karaoke" },
  },
  {
    id: "lyricGlow",
    role: "lyric",
    style: { font: "montserrat", weight: 700, size: 72, color: "#ffffff", highlight: "#ff7ce6", glow: 0.8, shadow: 0, y: 0.5, width: 0.8, spacing: 0.02 },
    anim: { in: "fade", out: "fade", inDur: 0.25, outDur: 0.25, emphasis: "karaoke" },
  },
  {
    id: "lyricBold",
    role: "lyric",
    style: { font: "anton", weight: 400, uppercase: true, size: 104, color: "#ffffff", highlight: "#ffd400", stroke: 8, shadow: 0.4, y: 0.5, width: 0.78, lineHeight: 1.05 },
    anim: { in: "pop", out: "zoom", inDur: 0.25, outDur: 0.2, emphasis: "karaoke" },
  },
  {
    id: "lyricSerif",
    role: "lyric",
    style: { font: "playfair", weight: 700, italic: true, size: 76, color: "#fff6e8", highlight: "#ffb347", shadow: 0.55, y: 0.78, width: 0.82 },
    anim: { in: "fade", out: "fade", inDur: 0.45, outDur: 0.4, emphasis: "karaoke" },
  },
];

export function presetById(id: string): TextPreset {
  return TEXT_PRESETS.find((p) => p.id === id) ?? TEXT_PRESETS[0];
}

export function textFromPreset(presetId: string, content: string): TextContent {
  const preset = presetById(presetId);
  return {
    content,
    role: preset.role,
    preset: preset.id,
    style: { ...BASE_STYLE, ...preset.style },
    anim: { ...BASE_ANIM, ...preset.anim },
  };
}

/** Re-style existing text with a preset, keeping its words and (for titles) its position. */
export function applyPreset(text: TextContent, presetId: string): TextContent {
  const next = textFromPreset(presetId, text.content);
  if (next.role === text.role && text.role === "title" && presetById(presetId).style.x === undefined) {
    next.style.x = text.style.x;
    next.style.y = text.style.y;
  }
  return text.lang ? { ...next, lang: text.lang } : next;
}

/** Older or hand-edited projects may miss fields; fill them so drawing never sees undefined. */
export function normalizeText(text: Partial<TextContent> | undefined): TextContent {
  const base = textFromPreset(text?.preset ?? "clean", text?.content ?? "");
  return {
    content: typeof text?.content === "string" ? text.content : "",
    role: text?.role ?? base.role,
    preset: text?.preset ?? base.preset,
    style: { ...base.style, ...(text?.style ?? {}) },
    anim: { ...base.anim, ...(text?.anim ?? {}) },
  };
}

export const TEXT_DEFAULT_SECONDS = 3;

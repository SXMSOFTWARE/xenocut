// Edit presets: one-click looks made of clip effects (project/effects.ts), so they preview and
// export exactly like hand-made effect stacks and stay editable afterwards.
import { previewFx, vignetteGradient, type ClipEffect, type EffectKind } from "./effects";

export type PresetId = "cinematic" | "vintage" | "vhs" | "noir" | "dreamy" | "punchy" | "cold" | "glitch" | "kenBurns" | "impact" | "faded" | "sunset";

export interface EditPreset {
  id: PresetId;
  effects: ClipEffect[];
}

const fx = (list: [EffectKind, number][]): ClipEffect[] => list.map(([kind, amount]) => ({ kind, amount }));

export const PRESETS: EditPreset[] = [
  { id: "cinematic", effects: fx([["contrast", 0.25], ["saturation", -0.15], ["temperature", 0.3], ["vignette", 0.45]]) },
  { id: "vintage", effects: fx([["sepia", 0.45], ["contrast", -0.15], ["brightness", 0.06], ["vignette", 0.5], ["grain", 0.5]]) },
  { id: "vhs", effects: fx([["saturation", 0.25], ["contrast", 0.1], ["rgbSplit", 0.45], ["blur", 0.08], ["grain", 0.45]]) },
  { id: "noir", effects: fx([["bw", 1], ["contrast", 0.45], ["brightness", -0.06], ["vignette", 0.6], ["grain", 0.25]]) },
  { id: "dreamy", effects: fx([["brightness", 0.14], ["contrast", -0.2], ["saturation", -0.1], ["temperature", 0.2], ["blur", 0.07], ["vignette", 0.25]]) },
  { id: "punchy", effects: fx([["contrast", 0.35], ["saturation", 0.4], ["sharpen", 0.45]]) },
  { id: "cold", effects: fx([["temperature", -0.6], ["saturation", -0.15], ["contrast", 0.12]]) },
  { id: "glitch", effects: fx([["contrast", 0.2], ["saturation", 0.2], ["rgbSplit", 0.75], ["shake", 0.35], ["grain", 0.2]]) },
  { id: "faded", effects: fx([["contrast", -0.3], ["brightness", 0.1], ["saturation", -0.3], ["grain", 0.2]]) },
  { id: "sunset", effects: fx([["temperature", 0.7], ["saturation", 0.2], ["contrast", 0.1], ["vignette", 0.3]]) },
  { id: "kenBurns", effects: fx([["zoomIn", 0.45], ["contrast", 0.08]]) },
  { id: "impact", effects: fx([["contrast", 0.3], ["rgbSplit", 0.3], ["zoomIn", 0.3], ["shake", 0.6], ["vignette", 0.35]]) },
];

export const PRESET_IDS = PRESETS.map((p) => p.id);

/** Effects match a preset when they hold exactly the same kinds and amounts. */
export function matchingPreset(effects: ClipEffect[] | undefined): PresetId | null {
  if (!effects?.length) return null;
  const key = (list: ClipEffect[]) => list.map((e) => `${e.kind}:${Math.round(e.amount * 100)}`).sort().join("|");
  const k = key(effects);
  return PRESETS.find((p) => key(p.effects) === k)?.id ?? null;
}

/** Swatch look for a preset card: colour filters (no SVG sharpen / split) plus the vignette overlay. */
export function presetSwatch(preset: EditPreset): { filter: string; overlay: string | undefined } {
  const f = previewFx(preset.effects, 1080, 0.1);
  const filter = f.filter
    .split(/\s+(?=[a-z-]+\()/)
    .filter((part) => !part.startsWith("url(\"#xc-fx-svg") && !part.startsWith("url(#xc-fx-svg"))
    .join(" ");
  return { filter: filter || "none", overlay: f.vignette > 0 ? vignetteGradient(f.vignette) : undefined };
}

/** Temperature values the preset swatches need as SVG defs. */
export const PRESET_TEMPERATURES = [...new Set(PRESETS.flatMap((p) => p.effects.filter((e) => e.kind === "temperature").map((e) => Math.round(e.amount * 100))))];

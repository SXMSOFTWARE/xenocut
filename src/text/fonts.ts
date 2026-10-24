// Title fonts (all SIL OFL 1.1, bundled; see About > Credits). Latin + Latin Extended only, so
// Turkish and most European text renders with the real glyphs. Loaded on demand by the browser
// through unicode-range; `ensureFonts()` waits for them before canvas drawing.
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-ext-800.css";
import "@fontsource/montserrat/latin-700.css";
import "@fontsource/montserrat/latin-ext-700.css";
import "@fontsource/montserrat/latin-800-italic.css";
import "@fontsource/montserrat/latin-ext-800-italic.css";
import "@fontsource/bebas-neue/latin-400.css";
import "@fontsource/bebas-neue/latin-ext-400.css";
import "@fontsource/anton/latin-400.css";
import "@fontsource/anton/latin-ext-400.css";
import "@fontsource/oswald/latin-600.css";
import "@fontsource/oswald/latin-ext-600.css";
import "@fontsource/playfair-display/latin-700.css";
import "@fontsource/playfair-display/latin-ext-700.css";
import "@fontsource/playfair-display/latin-700-italic.css";
import "@fontsource/playfair-display/latin-ext-700-italic.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/caveat/latin-ext-700.css";
import "@fontsource/bangers/latin-400.css";
import "@fontsource/bangers/latin-ext-400.css";

export type FontId = "inter" | "montserrat" | "bebas" | "anton" | "oswald" | "playfair" | "caveat" | "bangers";

export interface FontSpec {
  id: FontId;
  label: string;
  family: string;
  /** Weights bundled for this family (the first is the default). */
  weights: number[];
  /** Has a bundled italic. */
  italic: boolean;
  /** Visually larger/smaller than Inter at the same size; used to keep presets balanced. */
  scale: number;
}

export const FONTS: FontSpec[] = [
  { id: "inter", label: "Inter", family: "Inter", weights: [800, 700, 600, 500, 400], italic: false, scale: 1 },
  { id: "montserrat", label: "Montserrat", family: "Montserrat", weights: [800, 700], italic: true, scale: 1 },
  { id: "bebas", label: "Bebas Neue", family: "Bebas Neue", weights: [400], italic: false, scale: 1.25 },
  { id: "anton", label: "Anton", family: "Anton", weights: [400], italic: false, scale: 1.1 },
  { id: "oswald", label: "Oswald", family: "Oswald", weights: [600], italic: false, scale: 1.1 },
  { id: "playfair", label: "Playfair Display", family: "Playfair Display", weights: [700], italic: true, scale: 1 },
  { id: "caveat", label: "Caveat", family: "Caveat", weights: [700], italic: false, scale: 1.3 },
  { id: "bangers", label: "Bangers", family: "Bangers", weights: [400], italic: false, scale: 1.15 },
];

export function fontSpec(id: string): FontSpec {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** The nearest bundled weight, so the canvas never synthesises bold. */
export function fontWeight(spec: FontSpec, wanted: number): number {
  return spec.weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), spec.weights[0]);
}

const loaded = new Set<string>();

/** Wait until every face `texts` needs is ready (canvas text silently falls back otherwise). */
export async function ensureFonts(faces: { font: string; weight: number; italic: boolean; sample: string }[]): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const jobs: Promise<unknown>[] = [];
  for (const face of faces) {
    const spec = fontSpec(face.font);
    const css = `${face.italic && spec.italic ? "italic " : ""}${fontWeight(spec, face.weight)} 32px "${spec.family}"`;
    const key = `${css}|${face.sample}`;
    if (loaded.has(key)) continue;
    jobs.push(
      document.fonts
        .load(css, face.sample || "Aa")
        .then(() => loaded.add(key))
        .catch(() => undefined),
    );
  }
  if (jobs.length) await Promise.all(jobs);
}

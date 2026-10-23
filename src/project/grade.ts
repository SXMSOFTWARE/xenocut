// Project-wide colour grades. Each grade is a short list of CSS filter functions: the preview applies
// them as a CSS `filter`, and `src-tauri/src/grade.rs` folds the *same* list into one affine colour
// matrix for ffmpeg, so what you see is what you export.
export type Grade = "none" | "warm" | "cool" | "mono" | "vivid" | "fade" | "noir";

type Op = [fn: "sepia" | "saturate" | "grayscale" | "brightness" | "contrast" | "tint", ...args: number[]];

export const GRADES: Record<Grade, Op[]> = {
  none: [],
  warm: [["sepia", 0.22], ["saturate", 1.12], ["brightness", 1.03]],
  cool: [["saturate", 0.92], ["tint", 0.92, 1.0, 1.1], ["contrast", 1.04]],
  mono: [["grayscale", 1], ["contrast", 1.08]],
  vivid: [["saturate", 1.4], ["contrast", 1.06]],
  fade: [["contrast", 0.86], ["brightness", 1.06], ["saturate", 0.82]],
  noir: [["grayscale", 1], ["contrast", 1.38], ["brightness", 0.94]],
};

export const GRADE_IDS = Object.keys(GRADES) as Grade[];

/** `tint` has no CSS function; it is a per-channel gain, expressed as an inline SVG filter. */
export function gradeFilter(grade: Grade | undefined): string {
  const ops = GRADES[grade ?? "none"] ?? [];
  return ops
    .map(([fn, ...a]) => (fn === "tint" ? `url(#xc-tint-${grade})` : `${fn}(${a[0]})`))
    .join(" ") || "none";
}

/** Hidden SVG defs for the `tint` ops, rendered once by the editor. */
export function tintDefs(): { id: string; matrix: string }[] {
  const out: { id: string; matrix: string }[] = [];
  for (const id of GRADE_IDS) {
    for (const [fn, r, g, b] of GRADES[id]) {
      if (fn === "tint") out.push({ id: `xc-tint-${id}`, matrix: `${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0` });
    }
  }
  return out;
}

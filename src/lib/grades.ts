import type { Aspect, Grade, Resolution } from "../types";

export const ASPECTS: Aspect[] = ["9:16", "16:9", "1:1", "4:5"];

export const RESOLUTIONS: Resolution[] = ["720p", "1080p", "1440p", "4K"];

export const GRADES: Grade[] = ["None", "Warm", "Cool", "Mono", "Soft"];

export const GRADE_FILTER: Record<Grade, string> = {
  None: "none",
  Warm: "saturate(1.22) sepia(0.25) contrast(1.04)",
  Cool: "saturate(0.92) hue-rotate(16deg) contrast(1.04)",
  Mono: "grayscale(1) contrast(1.06)",
  Soft: "contrast(0.94) saturate(0.86) brightness(1.04)",
};

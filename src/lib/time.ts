export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const rounded = Math.round(seconds);
  if (rounded <= 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remain = rounded % 60;
  if (remain === 0) return `${minutes}m`;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

export interface RulerMark {
  time: number;
  kind: "label" | "dot";
}

export function rulerMarks(duration: number, width: number): RulerMark[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [{ time: 0, kind: "label" }];
  }

  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  let step = steps[steps.length - 1];
  const safeWidth = Math.max(width, 1);
  for (const candidate of steps) {
    if (candidate > duration) break;
    const gaps = duration / candidate;
    if (safeWidth / gaps >= 46) {
      step = candidate;
      break;
    }
  }

  const marks: RulerMark[] = [];
  const count = Math.max(1, Math.floor(duration / step));
  for (let index = 0; index <= count; index += 1) {
    const time = Math.min(duration, index * step);
    marks.push({ time, kind: "label" });
    if (index < count) {
      const mid = Math.min(duration, time + step / 2);
      if (mid < duration - step * 0.15) marks.push({ time: mid, kind: "dot" });
    }
  }

  const last = marks[marks.length - 1];
  if (!last || Math.abs(last.time - duration) > 0.05) {
    marks.push({ time: duration, kind: "label" });
  }
  return marks;
}

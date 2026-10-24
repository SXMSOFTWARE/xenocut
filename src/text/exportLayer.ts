// Pre-renders the text layer for an export: walks the timeline frame by frame, draws a new
// transparent PNG only when the text picture changes, and hands the frames to the backend,
// which writes an ffconcat list the FFmpeg export overlays above the picture.
import { invoke } from "@tauri-apps/api/core";
import { call, isTauri } from "../lib/backend";
import { projectDuration } from "../project/ops";
import type { Project } from "../project/types";
import { ensureFonts } from "./fonts";
import { activeTexts, drawTexts, textStateKey } from "./render";

export function hasVisibleText(project: Project): boolean {
  const tracks = new Set(project.tracks.filter((t) => t.kind === "text" && !t.hidden).map((t) => t.id));
  return project.clips.some((c) => tracks.has(c.trackId) && !!c.text && c.text.content.trim().length > 0);
}

export async function fontsFor(project: Project): Promise<void> {
  const faces = project.clips
    .filter((c) => c.text)
    .map((c) => ({ font: c.text!.style.font, weight: c.text!.style.weight, italic: c.text!.style.italic, sample: c.text!.content.slice(0, 60) }));
  await ensureFonts(faces);
}

export interface TextLayerJob {
  session: string;
  list: string;
  frames: number;
}

/** Throws "cancelled" when `cancelled()` turns true. Returns null when there is no text. */
export async function renderTextLayer(
  project: Project,
  width: number,
  height: number,
  fps: number,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): Promise<TextLayerJob | null> {
  if (!isTauri || !hasVisibleText(project)) return null;
  await fontsFor(project);
  const duration = projectDuration(project);
  const total = Math.max(1, Math.ceil(duration * fps - 1e-6));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const pw = project.settings.width;
  const ph = project.settings.height;
  const session = await call<string>("text_layer_begin");
  try {
    const entries: { frame: number; duration: number }[] = [];
    let files = 0;
    let previous: string | null = null;
    let blank = -1;
    let lastYield = performance.now();
    const send = async () => {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode a text frame.");
      const index = files++;
      await invoke("text_layer_frame", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-session": session, "x-frame": String(index) } });
      return index;
    };
    for (let f = 0; f < total; f++) {
      const t = f / fps;
      const key = textStateKey(project, t, f);
      if (key === previous) {
        entries[entries.length - 1].duration += 1 / fps;
        continue;
      }
      previous = key;
      if (cancelled()) throw new Error("cancelled");
      let index: number;
      if (!key) {
        if (blank < 0) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, width, height);
          blank = await send();
        }
        index = blank;
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.setTransform(width / pw, 0, 0, height / ph, 0, 0);
        drawTexts(ctx, project, t, pw, ph);
        index = await send();
      }
      entries.push({ frame: index, duration: 1 / fps });
      if (performance.now() - lastYield > 120) {
        onProgress(f / total);
        lastYield = performance.now();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress(1);
    const list = await call<string>("text_layer_finish", { session, entries });
    return { session, list, frames: files };
  } catch (error) {
    void call("text_layer_discard", { session }).catch(() => {});
    throw error;
  }
}

export function discardTextLayer(job: TextLayerJob | null) {
  if (job) void call("text_layer_discard", { session: job.session }).catch(() => {});
}

export { activeTexts };

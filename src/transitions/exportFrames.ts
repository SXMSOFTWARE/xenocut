// Export step for shader transitions: FFmpeg renders both sides of every shader transition
// through the clips' own chains (transition_sources), WebGL blends them frame by frame with
// the same renderer the preview uses, and the backend gets one ffconcat list per transition.
// Built-in xfade transitions need none of this; a transition that fails here falls back to
// its xfade in the export.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { call, isTauri } from "../lib/backend";
import type { Project } from "../project/types";
import { TransitionRenderer } from "./gl";
import { isShader, joins, transitionGlsl } from "./index";

interface TransitionSource {
  clipId: string;
  nextId: string;
  frames: number;
  duration: number;
  dir: string;
}

export interface TransitionFramesJob {
  session: string;
  /** Outgoing clip id → ffconcat list (the export option `transitionFrames`). */
  lists: Record<string, string>;
  frames: number;
  /** Transitions that could not be rendered (they export with their xfade fallback). */
  failed: string[];
}

export function hasShaderTransitions(project: Project): boolean {
  for (const j of joins(project.clips, project.tracks).values()) if (isShader(j.transition)) return true;
  return false;
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not read ${path}`));
    img.src = convertFileSrc(path);
  });
}

const frameFile = (dir: string, side: "from" | "to", k: number) => `${dir}/${side}_${String(k).padStart(5, "0")}.png`;

/** Throws "cancelled" when `cancelled()` turns true. Returns null when nothing needs WebGL. */
export async function renderTransitionFrames(
  project: Project,
  width: number,
  height: number,
  fps: number,
  onProgress: (p: number) => void,
  cancelled: () => boolean,
): Promise<TransitionFramesJob | null> {
  if (!isTauri || !hasShaderTransitions(project)) return null;
  const session = await call<string>("text_layer_begin");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new TransitionRenderer(canvas, true);
  try {
    const sources = await call<TransitionSource[]>("transition_sources", { project, session, width, height, fps });
    const total = Math.max(1, sources.reduce((n, s) => n + s.frames, 0));
    const lists: Record<string, string> = {};
    const failed: string[] = [];
    let files = 0, done = 0;
    for (const [i, src] of sources.entries()) {
      const clip = project.clips.find((c) => c.id === src.clipId);
      const shader = clip?.transition ? transitionGlsl(clip.transition) : null;
      if (!clip?.transition || !shader || renderer.check(shader.glsl, shader.builtin)) {
        failed.push(src.clipId);
        done += src.frames;
        continue;
      }
      const entries: { frame: number; duration: number }[] = [];
      let ok = true;
      for (let k = 0; k < src.frames; k++) {
        if (cancelled()) throw new Error("cancelled");
        const [from, to] = await Promise.all([loadImage(frameFile(src.dir, "from", k)), loadImage(frameFile(src.dir, "to", k))]);
        // Frame k of the window has progress k/N, like xfade.
        if (!renderer.render({ ...shader, params: clip.transition.params, from, to, progress: k / src.frames })) {
          ok = false;
          break;
        }
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("Could not encode a transition frame.");
        const index = files++;
        await invoke("text_layer_frame", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-session": session, "x-frame": String(index) } });
        entries.push({ frame: index, duration: 1 / fps });
        onProgress(++done / total);
      }
      if (!ok || entries.length === 0) {
        failed.push(src.clipId);
        continue;
      }
      lists[src.clipId] = await call<string>("text_layer_finish", { session, entries, name: `tr${i}` });
    }
    onProgress(1);
    return { session, lists, frames: files, failed };
  } catch (error) {
    void call("text_layer_discard", { session }).catch(() => {});
    throw error;
  } finally {
    renderer.dispose();
  }
}

export function discardTransitionFrames(job: TransitionFramesJob | null) {
  if (job) void call("text_layer_discard", { session: job.session }).catch(() => {});
}

// What the transition browser lists: the built-in xfade set plus the transitions of enabled packs
// (gl-transitions GLSL, loaded on demand), and the commands that put one on a cut.
import { useMemo } from "react";
import { enabledPacks, loadPackAsset, packFile, usePlugins, type Installed } from "../lib/plugins";
import { clipDuration, updateClip } from "../project/ops";
import type { Clip, ClipTransition, Project } from "../project/types";
import { useProject } from "../store/project";
import { BUILTINS, CATEGORIES, DEFAULT_DURATION, MAX_DURATION, MIN_DURATION, cuts, type TransitionCategory, type TransitionDef } from "./index";

export interface BrowserDef extends TransitionDef {
  /** Pack transitions: the GLSL file (text comes from `defGlsl`). */
  file?: string;
  packName?: string;
}

export function packTransitionDefs(installed: Installed[]): BrowserDef[] {
  return enabledPacks(installed).flatMap((p) =>
    (p.manifest.transitions ?? []).map((e) => ({
      id: `${p.manifest.id}/${e.id}`,
      name: e.name,
      category: (CATEGORIES as string[]).includes(e.category) ? (e.category as TransitionCategory) : "imported",
      glsl: "",
      builtin: false,
      fallback: e.fallback,
      duration: e.duration,
      packId: p.manifest.id,
      packName: p.manifest.name,
      author: e.author,
      license: e.license,
      file: packFile(p, e.file),
    })),
  );
}

export function useTransitionDefs(): BrowserDef[] {
  const installed = usePlugins((s) => s.installed);
  return useMemo(() => [...BUILTINS, ...packTransitionDefs(installed)], [installed]);
}

/** GLSL body of a browser entry (null when a pack file can't be read). */
export async function defGlsl(d: BrowserDef): Promise<string | null> {
  if (d.builtin || !d.file) return d.glsl;
  return loadPackAsset(d.file);
}

/** An adjacent pair on a track; `from` carries the transition. */
export interface Cut {
  from: Clip;
  to: Clip;
  cut: number;
}

/** The cut the browser edits: the one picked on the timeline, else the selected clip's join
 * (into the next clip, or from the previous one when it is the last). */
export function resolveCut(p: Project | null, selection: string[], picked: string | null): Cut | null {
  if (!p) return null;
  const all = cuts(p.clips, p.tracks);
  if (selection.length === 1) {
    const id = selection[0];
    return all.find((c) => c.from.id === id) ?? all.find((c) => c.to.id === id) ?? null;
  }
  if (selection.length === 0 && picked) return all.find((c) => c.from.id === picked) ?? null;
  return null;
}

/** Longest transition the cut allows (both clips must cover it). */
export function maxDuration(c: Cut): number {
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, clipDuration(c.from), clipDuration(c.to)));
}

const round = (v: number) => Math.round(v * 100) / 100;

function build(def: BrowserDef, glsl: string | null, prev: ClipTransition | undefined, c: Cut): ClipTransition {
  const want = prev?.duration ?? def.duration ?? DEFAULT_DURATION;
  const out: ClipTransition = { id: def.id, duration: round(Math.min(want, maxDuration(c))) };
  if (!def.builtin) {
    out.name = def.name;
    if (glsl) out.glsl = glsl;
    if (def.fallback) out.fallback = def.fallback;
  }
  if (prev?.id === def.id && prev.params) out.params = prev.params;
  return out;
}

/** Puts `def` on one cut (one undo step). Resolves false when the pack shader can't be read. */
export async function applyTransitionDef(def: BrowserDef, cut: Cut): Promise<boolean> {
  const glsl = await defGlsl(def);
  if (!def.builtin && !glsl) return false;
  const store = useProject.getState();
  const from = store.project?.clips.find((c) => c.id === cut.from.id);
  if (!from) return false;
  store.commit((p) => updateClip(p, from.id, { transition: build(def, glsl, from.transition, cut) }));
  return true;
}

/** Copies a cut's transition onto every cut of the project (one undo step). */
export function applyToAllCuts(src: ClipTransition) {
  useProject.getState().commit((p) => {
    let out = p;
    for (const c of cuts(p.clips, p.tracks)) {
      const t: ClipTransition = { ...structuredClone(src), duration: round(Math.min(src.duration, maxDuration(c))) };
      out = updateClip(out, c.from.id, { transition: t });
    }
    return out;
  });
}

export function removeCutTransition(fromId: string) {
  useProject.getState().commit((p) => updateClip(p, fromId, { transition: undefined }));
}

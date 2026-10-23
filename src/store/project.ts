// The open project plus its undo history. Edits go through `commit` (one undo step) or
// `transient` between `beginGesture` / `endGesture` (a drag becomes one undo step).
import { create } from "zustand";
import { api } from "../lib/backend";
import { messageOf } from "../lib/format";
import type { Project } from "../project/types";
import { projectDuration } from "../project/ops";
import { useRecent } from "./recent";
import { useAssets } from "./assets";

const HISTORY_LIMIT = 200;

export type SaveState = "saved" | "dirty" | "saving" | "error";

interface ProjectState {
  project: Project | null;
  path: string | null;
  saveState: SaveState;
  saveError: string | null;
  past: Project[];
  future: Project[];
  gestureBase: Project | null;
  selection: string[];
  selectedMediaId: string | null;

  open: (project: Project, path: string) => void;
  close: () => void;
  commit: (update: (project: Project) => Project) => void;
  transient: (update: (project: Project) => Project) => void;
  beginGesture: () => void;
  endGesture: () => void;
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  selectMedia: (id: string | null) => void;
  save: () => Promise<boolean>;
}

function changed(project: Project): Project {
  return { ...project, modified: new Date().toISOString() };
}

export const useProject = create<ProjectState>((set, get) => ({
  project: null,
  path: null,
  saveState: "saved",
  saveError: null,
  past: [],
  future: [],
  gestureBase: null,
  selection: [],
  selectedMediaId: null,

  open: (project, path) => {
    set({
      project,
      path,
      saveState: "saved",
      saveError: null,
      past: [],
      future: [],
      gestureBase: null,
      selection: [],
      selectedMediaId: null,
    });
    rememberRecent(project, path);
  },
  close: () => set({ project: null, path: null, past: [], future: [], selection: [], gestureBase: null }),

  commit: (update) => {
    const { project, past } = get();
    if (!project) return;
    const next = update(project);
    if (next === project) return;
    set({
      project: changed(next),
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      saveState: "dirty",
    });
  },

  transient: (update) => {
    const { project, gestureBase } = get();
    if (!project) return;
    const next = update(project);
    if (next === project) return;
    set({ project: next, gestureBase: gestureBase ?? project });
  },
  beginGesture: () => {
    const { project, gestureBase } = get();
    if (project && !gestureBase) set({ gestureBase: project });
  },
  endGesture: () => {
    const { project, gestureBase, past } = get();
    if (!project || !gestureBase) return;
    if (gestureBase === project) {
      set({ gestureBase: null });
      return;
    }
    set({
      project: changed(project),
      gestureBase: null,
      past: [...past, gestureBase].slice(-HISTORY_LIMIT),
      future: [],
      saveState: "dirty",
    });
  },
  cancelGesture: () => {
    const { gestureBase } = get();
    if (gestureBase) set({ project: gestureBase, gestureBase: null });
  },

  undo: () => {
    const { project, past, future } = get();
    if (!project || past.length === 0) return;
    const previous = past[past.length - 1];
    set({ project: previous, past: past.slice(0, -1), future: [project, ...future], saveState: "dirty", selection: keep(get().selection, previous) });
  },
  redo: () => {
    const { project, past, future } = get();
    if (!project || future.length === 0) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1), saveState: "dirty", selection: keep(get().selection, next) });
  },

  select: (ids) => set({ selection: ids }),
  selectMedia: (id) => set({ selectedMediaId: id }),

  save: async () => {
    const { project, path } = get();
    if (!project || !path) return false;
    set({ saveState: "saving" });
    try {
      await api.projectSave(path, project);
      // Edits made while writing stay dirty.
      if (get().project === project) set({ saveState: "saved", saveError: null });
      else set({ saveState: "dirty" });
      rememberRecent(project, path);
      return true;
    } catch (error) {
      set({ saveState: "error", saveError: messageOf(error) });
      return false;
    }
  },
}));

function keep(selection: string[], project: Project) {
  return selection.filter((id) => project.clips.some((c) => c.id === id));
}

function rememberRecent(project: Project, path: string) {
  const firstVisual = project.media.find((m) => m.kind !== "audio");
  const thumb = firstVisual ? useAssets.getState().assets[firstVisual.path]?.thumb ?? null : null;
  const previous = useRecent.getState().entries.find((e) => e.path === path);
  useRecent.getState().touch({
    path,
    name: project.name,
    modified: project.modified,
    aspect: project.settings.aspect,
    duration: projectDuration(project),
    thumb: thumb ?? previous?.thumb ?? null,
  });
}

// Keyboard shortcuts: a registry of editor actions with Premiere / CapCut-like default keys.
// Users can rebind any action in Settings; overrides live in the settings store.
import { engine } from "../../engine/playback";
import type { Key } from "../../i18n";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";
import { useSettings } from "../../store/settings";
import { deleteSelection, fitTimeline, jumpToEdge, splitAtPlayhead, zoomBy } from "./commands";
import {
  addMarker,
  addTransition,
  clearRange,
  copyAttributes,
  copySelection,
  cutSelection,
  detachAudio,
  duplicateSelection,
  paste,
  pasteAttributes,
  pasteEffects,
  selectAll,
  setRangeEdge,
  toggleClipMute,
} from "./edit";

export type ShortcutGroup = "playback" | "edit" | "clipboard" | "timeline" | "app";

export interface ShortcutAction {
  id: string;
  group: ShortcutGroup;
  keys: string[];
  run: () => void;
}

const fps = () => useProject.getState().project?.settings.fps ?? 30;
const stepBy = (seconds: number) => {
  engine.pause();
  engine.seek(engine.now() + seconds);
};

export function renameSelected() {
  const p = useProject.getState().project;
  const id = useProject.getState().selection[0];
  const clip = p?.clips.find((c) => c.id === id);
  if (!p || !clip) return;
  const media = p.media.find((m) => m.id === clip.mediaId);
  useEditorUi.setState({ rename: { kind: "clip", id, value: clip.name ?? media?.name ?? "" } });
}

/** Every action, in cheat-sheet order. Keys use `Mod` for Ctrl (⌘ on macOS). */
export const ACTIONS: ShortcutAction[] = [
  { id: "playPause", group: "playback", keys: ["Space"], run: () => engine.toggle() },
  { id: "shuttleBack", group: "playback", keys: ["J"], run: () => stepBy(-1) },
  { id: "pause", group: "playback", keys: ["K"], run: () => engine.pause() },
  { id: "play", group: "playback", keys: ["L"], run: () => engine.play() },
  { id: "frameBack", group: "playback", keys: ["ArrowLeft"], run: () => stepBy(-1 / fps()) },
  { id: "frameForward", group: "playback", keys: ["ArrowRight"], run: () => stepBy(1 / fps()) },
  { id: "secondBack", group: "playback", keys: ["Shift+ArrowLeft"], run: () => stepBy(-1) },
  { id: "secondForward", group: "playback", keys: ["Shift+ArrowRight"], run: () => stepBy(1) },
  { id: "prevEdit", group: "playback", keys: ["ArrowUp"], run: () => jumpToEdge(-1) },
  { id: "nextEdit", group: "playback", keys: ["ArrowDown"], run: () => jumpToEdge(1) },
  { id: "goStart", group: "playback", keys: ["Home"], run: () => engine.seek(0) },
  { id: "goEnd", group: "playback", keys: ["End"], run: () => engine.seek(engine.duration()) },

  { id: "split", group: "edit", keys: ["S", "Mod+K"], run: splitAtPlayhead },
  { id: "delete", group: "edit", keys: ["Delete", "Backspace"], run: deleteSelection },
  { id: "undo", group: "edit", keys: ["Mod+Z"], run: () => useProject.getState().undo() },
  { id: "redo", group: "edit", keys: ["Mod+Shift+Z", "Mod+Y"], run: () => useProject.getState().redo() },
  { id: "selectAll", group: "edit", keys: ["Mod+A"], run: selectAll },
  { id: "deselect", group: "edit", keys: ["Escape", "Mod+Shift+A"], run: () => useProject.getState().select([]) },
  { id: "rename", group: "edit", keys: ["F2"], run: renameSelected },
  { id: "muteClip", group: "edit", keys: ["Shift+M"], run: toggleClipMute },
  { id: "detachAudio", group: "edit", keys: ["Mod+Shift+D"], run: detachAudio },
  { id: "addTransition", group: "edit", keys: ["Mod+T"], run: () => addTransition() },

  { id: "copy", group: "clipboard", keys: ["Mod+C"], run: () => void copySelection() },
  { id: "cut", group: "clipboard", keys: ["Mod+X"], run: cutSelection },
  { id: "paste", group: "clipboard", keys: ["Mod+V"], run: paste },
  { id: "duplicate", group: "clipboard", keys: ["Mod+D"], run: duplicateSelection },
  { id: "copyAttributes", group: "clipboard", keys: ["Mod+Alt+C"], run: () => void copyAttributes() },
  { id: "pasteAttributes", group: "clipboard", keys: ["Mod+Alt+V", "Mod+Shift+V"], run: pasteAttributes },
  { id: "pasteEffects", group: "clipboard", keys: ["Alt+Shift+V"], run: pasteEffects },

  { id: "zoomIn", group: "timeline", keys: ["=", "+", "Mod+="], run: () => zoomBy(1.25) },
  { id: "zoomOut", group: "timeline", keys: ["-", "Mod+-"], run: () => zoomBy(0.8) },
  { id: "zoomFit", group: "timeline", keys: ["\\"], run: fitTimeline },
  { id: "marker", group: "timeline", keys: ["M"], run: addMarker },
  { id: "markIn", group: "timeline", keys: ["I"], run: () => setRangeEdge("in") },
  { id: "markOut", group: "timeline", keys: ["O"], run: () => setRangeEdge("out") },
  { id: "clearInOut", group: "timeline", keys: ["Mod+Shift+X"], run: clearRange },
  { id: "snap", group: "timeline", keys: ["N"], run: () => useEditorUi.setState((s) => ({ snapping: !s.snapping })) },

  { id: "save", group: "app", keys: ["Mod+S"], run: () => void saveNow() },
  { id: "export", group: "app", keys: ["Mod+E"], run: () => useProject.getState().project?.clips.length && useEditorUi.setState({ exportOpen: true }) },
  { id: "shortcuts", group: "app", keys: ["?"], run: () => useEditorUi.setState((s) => ({ shortcutsOpen: !s.shortcutsOpen })) },
];

let saved: ((ok: boolean) => void) | null = null;
/** Lets the editor show its "saved" toast without this module importing UI. */
export function onSaved(fn: ((ok: boolean) => void) | null) {
  saved = fn;
}
async function saveNow() {
  const ok = await useProject.getState().save();
  saved?.(ok);
}

export const actionLabel = (id: string) => `sc.${id}` as Key;
export const groupLabel = (g: ShortcutGroup) => `sc.group.${g}` as Key;

const MODS = ["Mod", "Alt", "Shift"] as const;

/** A key event as a combo string (`Mod+Shift+Z`, `Space`, `?`). Returns null for bare modifiers. */
export function comboOf(e: KeyboardEvent): string | null {
  if (["Control", "Meta", "Alt", "Shift", "AltGraph", "CapsLock", "Dead"].includes(e.key)) return null;
  let key = e.key;
  // Letters and digits by their physical key so Ctrl+Alt (AltGr on some layouts) still matches.
  if (/^Key[A-Z]$/.test(e.code) && (key.length !== 1 || !/[a-zA-Z]/.test(key) || e.altKey)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code) && (e.ctrlKey || e.metaKey || e.altKey)) key = e.code.slice(5);
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toUpperCase();
  // A shifted symbol already says so ("?" is Shift+/), but keep Shift for letters and named keys.
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && !symbol) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Splits a combo into modifiers and key ("Mod++" -> ["Mod"], "+"). */
function splitCombo(combo: string): { mods: string[]; key: string } {
  if (combo === "+") return { mods: [], key: "+" };
  if (combo.endsWith("++")) return { mods: combo.slice(0, -2).split("+").filter(Boolean), key: "+" };
  const parts = combo.split("+");
  const key = parts.pop() ?? "";
  return { mods: parts.filter(Boolean), key };
}

/** Normalised form so "shift+mod+z" and "Mod+Shift+Z" compare equal. */
export function normalizeCombo(combo: string): string {
  const { mods: raw, key: k } = splitCombo(combo);
  const mods = new Set(raw.map((m) => m[0].toUpperCase() + m.slice(1).toLowerCase()).map((m) => (m === "Ctrl" || m === "Cmd" || m === "Meta" ? "Mod" : m)));
  const key = k.length === 1 ? k.toUpperCase() : k;
  return [...MODS.filter((m) => mods.has(m)), key].join("+");
}

/** Keys of an action: the user's override or the defaults. */
export function keysOf(id: string, overrides = useSettings.getState().shortcuts): string[] {
  return overrides[id] ?? ACTIONS.find((a) => a.id === id)?.keys ?? [];
}

export function bindingMap(overrides = useSettings.getState().shortcuts): Map<string, ShortcutAction> {
  const map = new Map<string, ShortcutAction>();
  for (const action of ACTIONS) for (const combo of keysOf(action.id, overrides)) {
    const k = normalizeCombo(combo);
    if (!map.has(k)) map.set(k, action);
  }
  return map;
}

/** Actions sharing a combo with another action (shown as conflicts in Settings). */
export function conflicts(overrides = useSettings.getState().shortcuts): Set<string> {
  const seen = new Map<string, string>();
  const out = new Set<string>();
  for (const action of ACTIONS) for (const combo of keysOf(action.id, overrides)) {
    const k = normalizeCombo(combo);
    const other = seen.get(k);
    if (other && other !== action.id) {
      out.add(other);
      out.add(action.id);
    } else seen.set(k, action.id);
  }
  return out;
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Display form: `Ctrl+Shift+Z`, `⌘⇧Z` on macOS, arrows as glyphs. */
export function prettyCombo(combo: string): string[] {
  const names: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Delete: "Del", Backspace: "⌫", Space: "Space" };
  const { mods: n, key } = splitCombo(normalizeCombo(combo));
  const mods = n.map((m) => (isMac ? ({ Mod: "⌘", Alt: "⌥", Shift: "⇧" } as Record<string, string>)[m] : m === "Mod" ? "Ctrl" : m));
  return [...mods, names[key] ?? key];
}

/** Keys typed into fields stay there, except saving. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["range", "checkbox", "radio", "button"].includes(type);
  }
  return false;
}

/** Window keydown handler for the editor. */
export function handleShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false;
  const combo = comboOf(e);
  if (!combo) return false;
  const action = bindingMap().get(normalizeCombo(combo));
  if (!action) return false;
  if (typing(e.target) && action.id !== "save") return false;
  const ui = useEditorUi.getState();
  if (ui.exportOpen || ui.rename) return false;
  if (document.querySelector(".modal-backdrop") && action.id !== "shortcuts") return false;
  // Text selection in the page (e.g. a toast) shouldn't block copy, but a native selection inside
  // a non-editor element would: the editor wins.
  e.preventDefault();
  action.run();
  return true;
}

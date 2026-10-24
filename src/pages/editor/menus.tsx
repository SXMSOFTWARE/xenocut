// Context menus of the editor (right click; long press on phones). Every action goes through
// the same commands as the shortcuts, so all of it is undoable.
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  Layers,
  Lock,
  MapPin,
  Pause,
  PencilLine,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Unlink,
  Volume2,
  VolumeX,
  Wand2,
  ArrowUp,
  ArrowDown,
  Crosshair,
  Unlock,
} from "lucide-react";
import { openMenu, type MenuEntry } from "../../components/ContextMenu";
import { engine } from "../../engine/playback";
import { t, type Key } from "../../i18n";
import { revealInFolder } from "../../lib/backend";
import { addToTimeline } from "../../project/actions";
import { clipDuration, isEffectLayer, updateClip } from "../../project/ops";
import type { Clip, Project, TrackKind } from "../../project/types";
import { EFFECT_DEF } from "../../project/effects";
import { useEditorUi } from "../../store/editorUi";
import { useProject } from "../../store/project";
import { usePlayback } from "../../store/playback";
import { addTrack, removeTrack, splitAtPlayhead } from "./commands";
import {
  addEffectLayerHere,
  addMarker,
  addTransition,
  copyAttributes,
  copySelection,
  cutSelection,
  deleteClips,
  detachAudio,
  duplicateSelection,
  editableSelection,
  moveTargets,
  moveToTrack,
  nextAdjacent,
  paste,
  pasteAttributes,
  pasteEffects,
  removeTransition,
  resetEffects,
  setRangeEdge,
  setSpeed,
  toggleClipMute,
  toggleTrackFlag,
  useClipboard,
} from "./edit";
import { keysOf, prettyCombo, renameSelected } from "./shortcuts";

const hint = (action: string) => {
  const k = keysOf(action)[0];
  return k ? prettyCombo(k).join(navigator.platform.includes("Mac") ? "" : "+") : undefined;
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Right-click on a clip: it joins the selection (or replaces it when it wasn't selected). */
export function clipMenu(e: React.MouseEvent | { clientX: number; clientY: number }, clipId: string) {
  const store = useProject.getState();
  const p = store.project;
  const clip = p?.clips.find((c) => c.id === clipId);
  if (!p || !clip) return;
  if (!store.selection.includes(clipId)) store.select([clipId]);
  const sel = new Set(useProject.getState().selection);
  const clips = p.clips.filter((c) => sel.has(c.id));
  const track = p.tracks.find((tr) => tr.id === clip.trackId);
  const locked = !!track?.locked;
  const media = p.media.find((m) => m.id === clip.mediaId);
  const layer = isEffectLayer(clip);
  const visual = !clip.text && !clip.lottie && !layer && media?.kind !== "audio";
  const clipboard = useClipboard.getState();
  const editable = editableSelection(p).length > 0;
  const nAdj = !!nextAdjacent(p, clip);
  const speedable = media && media.kind !== "image";
  const audible = media && (media.kind === "audio" || media.hasAudio);
  const targets = moveTargets(p, clips).filter((tr) => clips.some((c) => c.trackId !== tr.id));
  const title = clips.length > 1 ? t("menu.nClips", { n: clips.length }) : clip.name ?? (clip.text ? clip.text.content.split("\n")[0] : layer ? t("menu.effectLayer") : media?.name);
  const items: MenuEntry[] = [
    { label: t("sc.split"), icon: <Scissors />, hint: hint("split"), run: splitAtPlayhead, disabled: locked },
    { label: t("sc.cut"), icon: <Scissors />, hint: hint("cut"), run: cutSelection, disabled: !editable },
    { label: t("sc.copy"), icon: <Copy />, hint: hint("copy"), run: () => void copySelection() },
    { label: t("sc.paste"), icon: <ClipboardPaste />, hint: hint("paste"), run: paste, disabled: !clipboard.clips.length },
    { label: t("sc.duplicate"), icon: <CopyPlus />, hint: hint("duplicate"), run: duplicateSelection },
    { label: t("sc.delete"), icon: <Trash2 />, hint: hint("delete"), danger: true, run: () => deleteClips([...sel]), disabled: !editable },
    "-",
    !clip.text && { label: t("menu.copyEffects"), icon: <Copy />, hint: hint("copyAttributes"), run: () => void copyAttributes() },
    clip.text && { label: t("menu.copyStyle"), icon: <Copy />, hint: hint("copyAttributes"), run: () => void copyAttributes() },
    !clip.text && { label: t("sc.pasteEffects"), icon: <ClipboardPaste />, hint: hint("pasteEffects"), run: pasteEffects, disabled: !clipboard.attrs || !editable },
    { label: t("sc.pasteAttributes"), icon: <ClipboardPaste />, hint: hint("pasteAttributes"), run: pasteAttributes, disabled: !clipboard.attrs || !editable },
    !layer && { label: t("menu.resetEffects"), icon: <Eraser />, run: resetEffects, disabled: !editable || !clips.some((c) => c.effects?.length || c.lut || c.anim) },
    "-",
    (visual || clip.text) && { label: t("menu.addAnimation"), icon: <Wand2 />, run: () => useEditorUi.setState({ panel: "anim" }) },
    visual && (clip.transition
      ? { label: t("menu.removeTransition"), icon: <ArrowRightLeft />, run: removeTransition, disabled: !editable }
      : { label: t("sc.addTransition"), icon: <ArrowRightLeft />, hint: hint("addTransition"), run: () => addTransition(), disabled: !nAdj || !editable }),
    layer || clip.text ? null : { label: t("menu.addEffect"), icon: <Sparkles />, run: () => useEditorUi.setState({ panel: "fx" }) },
    speedable && {
      label: t("inspector.speed"),
      icon: <Gauge />,
      disabled: !editable,
      submenu: SPEEDS.map((s) => ({ label: `${s}×`, checked: Math.abs(clip.speed - s) < 1e-3, run: () => setSpeed(s) })),
    },
    audible && { label: clips.every((c) => c.volume === 0) ? t("menu.unmute") : t("menu.mute"), icon: clip.volume === 0 ? <Volume2 /> : <VolumeX />, hint: hint("muteClip"), run: toggleClipMute, disabled: !editable },
    media?.kind === "video" && media.hasAudio && track?.kind === "video" && { label: t("sc.detachAudio"), icon: <Unlink />, hint: hint("detachAudio"), run: detachAudio, disabled: !editable || clip.volume === 0 },
    "-",
    { label: t("sc.rename"), icon: <PencilLine />, hint: hint("rename"), run: renameSelected },
    targets.length > 0 && {
      label: t("menu.moveToTrack"),
      icon: <ArrowDownToLine />,
      disabled: !editable,
      submenu: targets.map((tr) => ({ label: tr.name, run: () => moveToTrack(tr.id) })),
    },
    { label: t("menu.addEffectLayer"), icon: <Layers />, run: addEffectLayerHere },
    "-",
    track && { label: track.locked ? t("menu.unlockTrack") : t("menu.lockTrack"), icon: track.locked ? <Unlock /> : <Lock />, run: () => toggleTrackFlag(track.id, "locked") },
    track && track.kind !== "audio" && track.kind !== "music" && { label: track.hidden ? t("menu.showTrack") : t("menu.hideTrack"), icon: track.hidden ? <Eye /> : <EyeOff />, run: () => toggleTrackFlag(track.id, "hidden") },
  ];
  openMenu(e, items, title);
}

const KINDS: TrackKind[] = ["video", "audio", "music", "text", "effect"];

/** Right-click on a track header or on empty lane space (`time` = where on the lane). */
export function trackMenu(e: React.MouseEvent | { clientX: number; clientY: number }, trackId: string, time?: number, canRemove = true) {
  const p = useProject.getState().project;
  const track = p?.tracks.find((tr) => tr.id === trackId);
  if (!p || !track) return;
  const clipboard = useClipboard.getState().clips;
  const onTrack = p.clips.filter((c) => c.trackId === trackId);
  const audio = track.kind === "audio" || track.kind === "music";
  const items: MenuEntry[] = [
    time !== undefined && {
      label: t("menu.pasteHere"),
      icon: <ClipboardPaste />,
      disabled: !clipboard.length || !!track.locked,
      run: () => {
        engine.seek(time);
        paste();
      },
    },
    time !== undefined && { label: t("sc.marker"), icon: <MapPin />, hint: hint("marker"), run: () => (engine.seek(time), addMarker()) },
    { label: t("menu.selectTrack"), icon: <Layers />, run: () => useProject.getState().select(onTrack.map((c) => c.id)), disabled: !onTrack.length || !!track.locked },
    "-",
    { label: t("menu.renameTrack"), icon: <PencilLine />, run: () => useEditorUi.setState({ rename: { kind: "track", id: track.id, value: track.name } }) },
    track.kind !== "text" && track.kind !== "effect" && { label: track.muted ? t("menu.unmuteTrack") : t("menu.muteTrack"), icon: track.muted ? <Volume2 /> : <VolumeX />, run: () => toggleTrackFlag(track.id, "muted") },
    !audio && { label: track.hidden ? t("menu.showTrack") : t("menu.hideTrack"), icon: track.hidden ? <Eye /> : <EyeOff />, run: () => toggleTrackFlag(track.id, "hidden") },
    { label: track.locked ? t("menu.unlockTrack") : t("menu.lockTrack"), icon: track.locked ? <Unlock /> : <Lock />, run: () => toggleTrackFlag(track.id, "locked") },
    "-",
    { label: t("menu.addTrack"), icon: <Plus />, submenu: KINDS.map((k) => ({ label: t(`track.${k}` as Key), run: () => addTrack(k) })) },
    { label: t("menu.addEffectLayer"), icon: <Layers />, run: () => (time !== undefined && engine.seek(time), useProject.getState().select([]), addEffectLayerHere()) },
    canRemove && { label: t("menu.deleteTrack"), icon: <Trash2 />, danger: true, run: () => removeTrack(track.id) },
  ];
  openMenu(e, items, track.name);
}

/** Right-click on a media card in the bin. */
export function mediaMenu(e: React.MouseEvent | { clientX: number; clientY: number }, mediaId: string, remove: () => void) {
  const p = useProject.getState().project;
  const media = p?.media.find((m) => m.id === mediaId);
  if (!p || !media) return;
  useProject.getState().selectMedia(media.id);
  const used = p.clips.filter((c) => c.mediaId === media.id);
  const items: MenuEntry[] = [
    { label: t("bin.addAtPlayhead"), icon: <Plus />, run: () => addToTimeline(media, usePlayback.getState().time) },
    { label: t("menu.addAtEnd"), icon: <ArrowDownToLine />, run: () => addAtEnd(p, media.id) },
    { label: t("menu.selectUses"), icon: <Layers />, disabled: !used.length, run: () => useProject.getState().select(used.map((c) => c.id)) },
    "-",
    { label: t("menu.reveal"), icon: <FolderOpen />, run: () => void revealInFolder(media.path) },
    "-",
    { label: t("bin.remove"), icon: <Trash2 />, danger: true, run: remove },
  ];
  openMenu(e, items, media.name);
}

function addAtEnd(p: Project, mediaId: string) {
  const media = p.media.find((m) => m.id === mediaId);
  if (!media) return;
  const id = addToTimeline(media, 1e6);
  const clip = useProject.getState().project?.clips.find((c) => c.id === id);
  if (clip) engine.seek(clip.start);
}

/** Right-click on the preview: playback, markers and the selected clip's essentials. */
export function previewMenu(e: React.MouseEvent | { clientX: number; clientY: number }) {
  const p = useProject.getState().project;
  if (!p) return;
  const playing = usePlayback.getState().playing;
  const sel = editableSelection(p);
  const clipboard = useClipboard.getState();
  const items: MenuEntry[] = [
    { label: playing ? t("sc.pause") : t("sc.play"), icon: playing ? <Pause /> : <Play />, hint: hint("playPause"), run: () => engine.toggle() },
    { label: t("sc.split"), icon: <Scissors />, hint: hint("split"), run: splitAtPlayhead, disabled: !p.clips.length },
    { label: t("sc.marker"), icon: <MapPin />, hint: hint("marker"), run: addMarker },
    { label: t("sc.markIn"), hint: hint("markIn"), run: () => setRangeEdge("in") },
    { label: t("sc.markOut"), hint: hint("markOut"), run: () => setRangeEdge("out") },
    "-",
    { label: t("sc.paste"), icon: <ClipboardPaste />, hint: hint("paste"), run: paste, disabled: !clipboard.clips.length },
    sel.length > 0 && { label: t("sc.pasteAttributes"), icon: <ClipboardPaste />, hint: hint("pasteAttributes"), run: pasteAttributes, disabled: !clipboard.attrs },
    sel.length > 0 && { label: t("menu.addEffect"), icon: <Sparkles />, run: () => useEditorUi.setState({ panel: "fx" }) },
    sel.length > 0 && { label: t("menu.addAnimation"), icon: <Wand2 />, run: () => useEditorUi.setState({ panel: "anim" }) },
    "-",
    { label: t("sc.shortcuts"), hint: hint("shortcuts"), run: () => useEditorUi.setState({ shortcutsOpen: true }) },
  ];
  openMenu(e, items);
}

/** Right-click on an effect in a clip's effect stack. */
export function effectMenu(e: React.MouseEvent | { clientX: number; clientY: number }, clip: Clip, index: number) {
  const effects = clip.effects ?? [];
  const fx = effects[index];
  if (!fx) return;
  const commit = useProject.getState().commit;
  const set = (next: typeof effects) => commit((p) => updateClip(p, clip.id, { effects: next.length ? next : undefined }));
  const move = (d: -1 | 1) => {
    const next = [...effects];
    const [it] = next.splice(index, 1);
    next.splice(index + d, 0, it);
    set(next);
  };
  const def = EFFECT_DEF[fx.kind];
  const items: MenuEntry[] = [
    { label: t("menu.moveUp"), icon: <ArrowUp />, disabled: index === 0, run: () => move(-1) },
    { label: t("menu.moveDown"), icon: <ArrowDown />, disabled: index === effects.length - 1, run: () => move(1) },
    { label: t("sc.duplicate"), icon: <CopyPlus />, run: () => set([...effects.slice(0, index + 1), structuredClone(fx), ...effects.slice(index + 1)]) },
    def && !def.toggle && { label: t("menu.resetAmount"), icon: <Eraser />, run: () => set(effects.map((x, i) => (i === index ? { ...x, amount: def.initial } : x))) },
    (fx.from !== undefined || fx.to !== undefined) && { label: t("menu.wholeClip"), icon: <Crosshair />, run: () => set(effects.map((x, i) => (i === index ? { ...x, from: undefined, to: undefined } : x))) },
    { label: t("fx.showRange"), icon: <Crosshair />, run: () => (useEditorUi.setState({ fxFocus: { clipId: clip.id, index } }), engine.seek(clip.start + Math.max(0, Math.min(clipDuration(clip), fx.from ?? 0)))) },
    "-",
    { label: t("menu.copyEffects"), icon: <Copy />, run: () => (useProject.getState().select([clip.id]), copyAttributes()) },
    "-",
    { label: t("fx.remove"), icon: <Trash2 />, danger: true, run: () => set(effects.filter((_, i) => i !== index)) },
  ];
  openMenu(e, items, def ? t(`fx.${fx.kind}` as Key) : fx.kind);
}

/** Where a lane click lands in seconds. */
export function laneTime(e: { clientX: number }, lane: HTMLElement, pps: number): number {
  return Math.max(0, (e.clientX - lane.getBoundingClientRect().left) / pps);
}


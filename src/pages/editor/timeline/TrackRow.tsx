import { memo, useMemo } from "react";
import { Eye, EyeOff, Film, Music2, Plus, Sparkles, Trash2, Type, Volume2, VolumeX, AudioLines } from "lucide-react";
import { engine } from "../../../engine/playback";
import { useT } from "../../../i18n";
import type { Clip, MediaItem, Track } from "../../../project/types";
import { useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { importDialog, addToTimeline } from "../../../project/actions";
import { clipDuration } from "../../../project/ops";
import { removeTrack, toggleTrack } from "../commands";
import { ClipView, EffectLayerView, TextClipView } from "./ClipView";
import { CutMarks } from "./CutMarks";
import { useLongPress } from "../../../components/ContextMenu";
import { clipMenu, laneTime, trackMenu } from "../menus";
import { Lock, Unlock } from "lucide-react";

const ICON = { video: Film, audio: AudioLines, music: Music2, text: Type, effect: Sparkles };

interface Props {
  track: Track;
  clips: Clip[];
  media: Map<string, MediaItem>;
  pps: number;
  height: number;
  canRemove: boolean;
  /** Render the round "+" after the last clip (main video track). */
  showAdd?: boolean;
}

const TINTS = ["blue", "gold", "lavender", "copper"] as const;

export const TrackRow = memo(function TrackRow({ track, clips, media, pps, height, canRemove, showAdd }: Props) {
  const t = useT();
  const selection = useProject((s) => s.selection);
  const hint = useEditorUi((s) => (s.dropHint?.trackId === track.id ? s.dropHint : null));
  const selected = useMemo(() => new Set(selection), [selection]);
  const Icon = ICON[track.kind];
  const end = clips.reduce((max, c) => Math.max(max, c.start + clipDuration(c)), 0);
  // One handler per row: a clip under the pointer gets the clip menu, empty lane space the track menu.
  const laneMenu = useLongPress((e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const clipEl = el?.closest<HTMLElement>("[data-clip-id]");
    const lane = el?.closest<HTMLElement>("[data-lane]");
    if (clipEl?.dataset.clipId) clipMenu(e, clipEl.dataset.clipId);
    else if (lane) trackMenu(e, track.id, laneTime(e, lane, pps), canRemove);
  });
  const headMenu = useLongPress((e) => trackMenu(e, track.id, undefined, canRemove));

  return (
    <div className={`tl-row kind-${track.kind}${track.muted ? " muted" : ""}${track.hidden ? " hidden" : ""}${track.locked ? " locked" : ""}`} style={{ height }}>
      <div className="tl-header" {...headMenu}>
        <span className={`tl-track-icon kind-${track.kind}`} title={track.name}>
          <Icon />
          {track.locked && <Lock className="tl-lock-badge" />}
        </span>
        <div className="tl-track-actions">
          <span className="tl-track-name">{track.name}</span>
          {(track.kind === "video" || track.kind === "text" || track.kind === "effect") && (
            <button className="mini-btn" onClick={() => toggleTrack(track.id, "hidden")} title={t(track.hidden ? "track.show" : "track.hide")} aria-label={t(track.hidden ? "track.show" : "track.hide")}>
              {track.hidden ? <EyeOff /> : <Eye />}
            </button>
          )}
          {track.kind !== "text" && track.kind !== "effect" && (
            <button className="mini-btn" onClick={() => toggleTrack(track.id, "muted")} title={t(track.muted ? "track.unmute" : "track.mute")} aria-label={t(track.muted ? "track.unmute" : "track.mute")}>
              {track.muted ? <VolumeX /> : <Volume2 />}
            </button>
          )}
          {(
            <button className={`mini-btn${track.locked ? " on" : ""}`} onClick={() => toggleTrack(track.id, "locked")} title={t(track.locked ? "menu.unlockTrack" : "menu.lockTrack")} aria-label={t(track.locked ? "menu.unlockTrack" : "menu.lockTrack")}>
              {track.locked ? <Lock /> : <Unlock />}
            </button>
          )}
          {canRemove && (
            <button className="mini-btn danger" onClick={() => removeTrack(track.id)} title={t("track.remove")} aria-label={t("track.remove")}>
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      <div className="tl-lane" data-lane="" data-track-id={track.id} onPointerDown={lanePointerDown} {...laneMenu}>
        {clips.map((clip, i) => {
          if (clip.text) return <TextClipView key={clip.id} clip={clip} pps={pps} selected={selected.has(clip.id)} />;
          if (track.kind === "effect") return <EffectLayerView key={clip.id} clip={clip} pps={pps} selected={selected.has(clip.id)} />;
          const m = media.get(clip.mediaId);
          const tint = track.kind === "video" ? TINTS[i % TINTS.length] : track.kind === "music" ? "gold" : "lavender";
          return m ? <ClipView key={clip.id} clip={clip} media={m} trackKind={track.kind} tint={tint} pps={pps} selected={selected.has(clip.id)} laneHeight={height} /> : null;
        })}
        {track.kind === "video" && <CutMarks track={track} clips={clips} pps={pps} />}
        {showAdd && (
          <button
            className="tl-add-clip"
            style={{ transform: `translateX(${end * pps + 8}px)` }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void appendMedia(track.id, end)}
            title={t("editor.addClip")}
            aria-label={t("editor.addClip")}
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        )}
        {hint && (
          <div
            className={`drop-hint${hint.start < 0 ? " invalid" : ""}`}
            style={{ transform: `translateX(${Math.max(0, hint.start) * pps}px)`, width: Math.max(4, hint.duration * pps) }}
          />
        )}
      </div>
    </div>
  );
});

/** Clicking empty lane space clears the selection and seeks there; dragging draws a selection
 * marquee over the clips (Shift / Ctrl add to the selection). */
export function lanePointerDown(e: React.PointerEvent<HTMLDivElement>) {
  if (e.button !== 0 || e.target !== e.currentTarget) return;
  if (useEditorUi.getState().cut) useEditorUi.setState({ cut: null });
  if (e.pointerType === "touch") {
    useProject.getState().select([]);
    return tapToSeek(e.currentTarget, e.clientX, e.clientY);
  }
  marquee(e.currentTarget, e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey);
}

function marquee(lane: HTMLElement, sx: number, sy: number, additive: boolean) {
  const store = useProject.getState();
  const base = additive ? store.selection : [];
  if (!additive) store.select([]);
  const root = lane.closest<HTMLElement>(".tl-scroll") ?? document.body;
  const box = document.createElement("div");
  box.className = "tl-marquee";
  let active = false;
  const locked = new Set(store.project?.tracks.filter((t) => t.locked).map((t) => t.id));
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
    if (!active) {
      active = true;
      document.body.appendChild(box);
    }
    const x0 = Math.min(sx, ev.clientX), x1 = Math.max(sx, ev.clientX);
    const y0 = Math.min(sy, ev.clientY), y1 = Math.max(sy, ev.clientY);
    Object.assign(box.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
    const hit: string[] = [];
    root.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const trackId = el.closest<HTMLElement>("[data-track-id]")?.dataset.trackId;
      if (trackId && locked.has(trackId)) return;
      if (r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1) hit.push(el.dataset.clipId!);
    });
    useProject.getState().select([...new Set([...base, ...hit])]);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    box.remove();
    if (!active && ev.type === "pointerup") {
      engine.pause();
      engine.seek(Math.max(0, (ev.clientX - lane.getBoundingClientRect().left) / useEditorUi.getState().pxPerSec));
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

/** Touch on empty lane space: a tap seeks there, a swipe is left to the browser to scroll. */
function tapToSeek(el: HTMLElement, sx: number, sy: number) {
  const done = (ev: PointerEvent) => {
    window.removeEventListener("pointerup", done);
    window.removeEventListener("pointercancel", done);
    if (ev.type !== "pointerup" || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) return;
    engine.pause();
    engine.seek((ev.clientX - el.getBoundingClientRect().left) / useEditorUi.getState().pxPerSec);
  };
  window.addEventListener("pointerup", done);
  window.addEventListener("pointercancel", done);
}

export function scrubFrom(el: HTMLElement, startX: number) {
  const seekAt = (x: number) => {
    const rect = el.getBoundingClientRect();
    engine.seek((x - rect.left) / useEditorUi.getState().pxPerSec);
  };
  engine.pause();
  seekAt(startX);
  const move = (ev: PointerEvent) => seekAt(ev.clientX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** The "+" after the clips: import files and lay them end to end from `at`. */
async function appendMedia(trackId: string, at: number) {
  const items = await importDialog();
  for (const m of items) {
    const id = addToTimeline(m, at, trackId);
    const clip = useProject.getState().project?.clips.find((c) => c.id === id);
    if (clip) at = clip.start + clipDuration(clip);
  }
}

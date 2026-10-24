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

  return (
    <div className={`tl-row kind-${track.kind}${track.muted ? " muted" : ""}${track.hidden ? " hidden" : ""}`} style={{ height }}>
      <div className="tl-header">
        <span className={`tl-track-icon kind-${track.kind}`} title={track.name}>
          <Icon />
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
          {canRemove && (
            <button className="mini-btn danger" onClick={() => removeTrack(track.id)} title={t("track.remove")} aria-label={t("track.remove")}>
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      <div className="tl-lane" data-lane="" data-track-id={track.id} onPointerDown={lanePointerDown}>
        {clips.map((clip, i) => {
          if (clip.text) return <TextClipView key={clip.id} clip={clip} pps={pps} selected={selected.has(clip.id)} />;
          if (track.kind === "effect") return <EffectLayerView key={clip.id} clip={clip} pps={pps} selected={selected.has(clip.id)} />;
          const m = media.get(clip.mediaId);
          const tint = track.kind === "video" ? TINTS[i % TINTS.length] : track.kind === "music" ? "gold" : "lavender";
          return m ? <ClipView key={clip.id} clip={clip} media={m} trackKind={track.kind} tint={tint} pps={pps} selected={selected.has(clip.id)} laneHeight={height} /> : null;
        })}
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

/** Clicking empty lane space clears the selection and scrubs the playhead. */
export function lanePointerDown(e: React.PointerEvent<HTMLDivElement>) {
  if (e.button !== 0 || e.target !== e.currentTarget) return;
  useProject.getState().select([]);
  if (e.pointerType === "touch") return tapToSeek(e.currentTarget, e.clientX, e.clientY);
  scrubFrom(e.currentTarget, e.clientX);
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

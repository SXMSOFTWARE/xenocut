import { memo, useMemo } from "react";
import { Eye, EyeOff, Film, Music2, Trash2, Volume2, VolumeX, AudioLines } from "lucide-react";
import { engine } from "../../../engine/playback";
import { useT } from "../../../i18n";
import type { Clip, MediaItem, Track } from "../../../project/types";
import { useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { removeTrack, toggleTrack } from "../commands";
import { ClipView } from "./ClipView";

const ICON = { video: Film, audio: AudioLines, music: Music2 };

interface Props {
  track: Track;
  clips: Clip[];
  media: Map<string, MediaItem>;
  pps: number;
  height: number;
  canRemove: boolean;
}

export const TrackRow = memo(function TrackRow({ track, clips, media, pps, height, canRemove }: Props) {
  const t = useT();
  const selection = useProject((s) => s.selection);
  const hint = useEditorUi((s) => (s.dropHint?.trackId === track.id ? s.dropHint : null));
  const selected = useMemo(() => new Set(selection), [selection]);
  const Icon = ICON[track.kind];

  return (
    <div className={`tl-row kind-${track.kind}${track.muted ? " muted" : ""}${track.hidden ? " hidden" : ""}`} style={{ height }}>
      <div className="tl-header">
        <span className={`tl-track-icon kind-${track.kind}`}>
          <Icon />
        </span>
        <span className="tl-track-name">{track.name}</span>
        <div className="tl-track-actions">
          {track.kind === "video" && (
            <button className="icon-btn xs flat" onClick={() => toggleTrack(track.id, "hidden")} title={t(track.hidden ? "track.show" : "track.hide")} aria-label={t(track.hidden ? "track.show" : "track.hide")}>
              {track.hidden ? <EyeOff /> : <Eye />}
            </button>
          )}
          <button className="icon-btn xs flat" onClick={() => toggleTrack(track.id, "muted")} title={t(track.muted ? "track.unmute" : "track.mute")} aria-label={t(track.muted ? "track.unmute" : "track.mute")}>
            {track.muted ? <VolumeX /> : <Volume2 />}
          </button>
          {canRemove && (
            <button className="icon-btn xs flat danger" onClick={() => removeTrack(track.id)} title={t("track.remove")} aria-label={t("track.remove")}>
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      <div className="tl-lane" data-lane="" data-track-id={track.id} onPointerDown={lanePointerDown}>
        {clips.map((clip) => {
          const m = media.get(clip.mediaId);
          return m ? <ClipView key={clip.id} clip={clip} media={m} trackKind={track.kind} pps={pps} selected={selected.has(clip.id)} laneHeight={height} /> : null;
        })}
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
  scrubFrom(e.currentTarget, e.clientX);
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

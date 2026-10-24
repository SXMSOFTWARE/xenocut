import { memo, useMemo, useState } from "react";
import { AudioLines, Film, Image as ImageIcon, Plus, Trash2, Upload } from "lucide-react";
import { useT } from "../../i18n";
import { fileSrc } from "../../lib/backend";
import { shortTime } from "../../lib/format";
import { addToTimeline, importDialog } from "../../project/actions";
import { clipDuration, nearestFreeStart, newClip, removeMediaAndClips, snap, snapCandidates, trackAccepts } from "../../project/ops";
import type { MediaItem, MediaKind } from "../../project/types";
import { useAssets } from "../../store/assets";
import { visibleBeats } from "../../store/beats";
import { useEditorUi } from "../../store/editorUi";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { toast } from "../../store/toast";
import { laneAtPoint } from "./timeline/geometry";

type Filter = "all" | MediaKind;

export function MediaBin() {
  const t = useT();
  const media = useProject((s) => s.project?.media);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => (media ?? []).filter((m) => filter === "all" || m.kind === filter), [media, filter]);

  const doImport = async () => {
    setBusy(true);
    try {
      await importDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bin">
      <div className="bin-filters">
        {(["all", "video", "audio", "image"] as Filter[]).map((f) => (
          <button key={f} className={`chip${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
            {t(`bin.filter.${f}`)}
          </button>
        ))}
        <div className="spacer" />
        <button className="mini-btn" onClick={() => void doImport()} disabled={busy} title={t("bin.import")} aria-label={t("bin.import")}>
          <Upload />
        </button>
      </div>
      {list.length === 0 ? (
        <button className="bin-empty empty" onClick={() => void doImport()}>
          <Upload />
          <b>{t("bin.emptyTitle")}</b>
          <span>{t("bin.emptyText")}</span>
        </button>
      ) : (
        <div className="bin-grid">
          {list.map((m) => (
            <MediaCard key={m.id} media={m} />
          ))}
        </div>
      )}
    </section>
  );
}

const KIND_ICON = { video: Film, audio: AudioLines, image: ImageIcon };

const MediaCard = memo(function MediaCard({ media }: { media: MediaItem }) {
  const t = useT();
  const assets = useAssets((s) => s.assets[media.path]);
  const selected = useProject((s) => s.selectedMediaId === media.id);
  const used = useProject((s) => s.project?.clips.some((c) => c.mediaId === media.id) ?? false);
  const Icon = KIND_ICON[media.kind];

  const remove = () => {
    useProject.getState().commit((p) => removeMediaAndClips(p, media.id));
    if (used) toast(t("bin.removedWithClips"), "info");
  };

  return (
    <div
      className={`media-card kind-${media.kind}${selected ? " selected" : ""}`}
      onPointerDown={(e) => startMediaDrag(e, media)}
      onDoubleClick={() => addToTimeline(media, usePlayback.getState().time)}
      title={media.path}
    >
      <div className="media-thumb">
        {assets?.thumb ? (
          <img src={fileSrc(assets.thumb)} alt="" draggable={false} loading="lazy" />
        ) : assets?.wave ? (
          <span className="media-wave" style={{ maskImage: `url("${fileSrc(assets.wave)}")`, WebkitMaskImage: `url("${fileSrc(assets.wave)}")` }} />
        ) : (
          <span className="media-ph">
            <Icon />
          </span>
        )}
        <span className="media-kind">
          <Icon />
        </span>
        {media.duration > 0 && <span className="media-dur tnum">{shortTime(media.duration)}</span>}
        {used && <span className="media-used" title={t("bin.inUse")} />}
        <div className="media-actions">
          <button
            className="icon-btn xs"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => addToTimeline(media, usePlayback.getState().time)}
            title={t("bin.addAtPlayhead")}
            aria-label={t("bin.addAtPlayhead")}
          >
            <Plus />
          </button>
          <button className="icon-btn xs" onPointerDown={(e) => e.stopPropagation()} onClick={remove} title={t("bin.remove")} aria-label={t("bin.remove")}>
            <Trash2 />
          </button>
        </div>
      </div>
      <div className="media-name">{media.name}</div>
    </div>
  );
});

/** Pointer-driven drag from the bin onto a timeline lane (HTML5 DnD is taken by the native drop). */
function startMediaDrag(e: React.PointerEvent, media: MediaItem) {
  if (e.button !== 0) return;
  useProject.getState().selectMedia(media.id);
  // Touch: tap selects, the always-visible + button adds; dragging from a sheet would fight scrolling.
  if (e.pointerType === "touch") return;
  const sx = e.clientX;
  const sy = e.clientY;
  let dragging = false;

  const hintFor = (x: number, y: number) => {
    const lane = laneAtPoint(x, y);
    const project = useProject.getState().project;
    if (!lane || !project) return null;
    const track = lane.trackId ? project.tracks.find((tr) => tr.id === lane.trackId) : null;
    const duration = clipDuration(newClip(media, lane.trackId ?? "", 0));
    const pps = useEditorUi.getState().pxPerSec;
    let time = lane.time;
    if (useEditorUi.getState().snapping) {
      const candidates = snapCandidates(project, usePlayback.getState().time, new Set(), visibleBeats(project));
      const head = snap(time, candidates, 8 / pps);
      const tail = snap(time + duration, candidates, 8 / pps);
      if (head.snapped !== null) time = head.time;
      else if (tail.snapped !== null) time = tail.time - duration;
    }
    if (track && !trackAccepts(track.kind, media)) return { trackId: track.id, start: -1, duration };
    const start = track ? nearestFreeStart(project, track.id, time, duration) : Math.max(0, time);
    return { trackId: lane.trackId, start, duration };
  };

  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
    dragging = true;
    useEditorUi.setState({ dragMedia: { mediaId: media.id, x: ev.clientX, y: ev.clientY }, dropHint: hintFor(ev.clientX, ev.clientY) });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!dragging) return;
    const hint = hintFor(ev.clientX, ev.clientY);
    useEditorUi.setState({ dragMedia: null, dropHint: null });
    if (hint && hint.start >= 0) addToTimeline(media, hint.start, hint.trackId);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

import { memo } from "react";
import { fileSrc } from "../../../lib/backend";
import { clipDuration } from "../../../project/ops";
import type { Clip, MediaAssets, MediaItem, TrackKind } from "../../../project/types";
import { useAssets } from "../../../store/assets";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { beginClipDrag } from "./clipDrag";

const MAX_TILES = 48;

interface Props {
  clip: Clip;
  media: MediaItem;
  trackKind: TrackKind;
  pps: number;
  selected: boolean;
  laneHeight: number;
  tint: string;
}

export const ClipView = memo(function ClipView({ clip, media, trackKind, pps, selected, laneHeight, tint }: Props) {
  const assets = useAssets((s) => s.assets[media.path]);
  const duration = clipDuration(clip);
  const width = Math.max(2, duration * pps);
  const tone = media.kind === "image" ? "image" : trackKind;
  const visual = trackKind === "video";
  const showWave = !!assets?.wave && (trackKind !== "video" || media.hasAudio);

  const pillH = laneHeight - 8;
  return (
    <div
      className={`clip tone-${tone} tint-${tint}${selected ? " selected" : ""}${width < 36 ? " tiny" : ""}`}
      style={{ transform: `translateX(${clip.start * pps}px)`, width }}
      data-clip-id={clip.id}
      title={media.name}
      onPointerDown={(e) => beginClipDrag(e, clip.id, "move")}
    >
      <div className="clip-body">
        {visual && assets && <Film clip={clip} media={media} assets={assets} width={width} pps={pps} height={pillH} />}
        {showWave && assets?.wave && !visual && <Wave clip={clip} media={media} wave={assets.wave} width={width} pps={pps} compact={false} />}
        <span className="clip-tint" />
        {!visual && (
          <div className="clip-label">
            <span>{media.name}</span>
            {clip.speed !== 1 && <em>{clip.speed.toFixed(2)}×</em>}
          </div>
        )}
        {visual && clip.speed !== 1 && <em className="clip-speed">{clip.speed.toFixed(2)}×</em>}
        {clip.fadeIn > 0 && <span className="clip-fade in" style={{ width: Math.min(width / 2, clip.fadeIn * pps) }} />}
        {clip.fadeOut > 0 && <span className="clip-fade out" style={{ width: Math.min(width / 2, clip.fadeOut * pps) }} />}
      </div>
      <span className="clip-handle start" onPointerDown={(e) => beginClipDrag(e, clip.id, "trim-start")} />
      <span className="clip-handle end" onPointerDown={(e) => beginClipDrag(e, clip.id, "trim-end")} />
      {selected && width >= 52 && (
        <>
          <span className="trim-btn start" onPointerDown={(e) => beginClipDrag(e, clip.id, "trim-start")}>
            <ChevronLeft size={12} strokeWidth={2.4} />
          </span>
          <span className="trim-btn end" onPointerDown={(e) => beginClipDrag(e, clip.id, "trim-end")}>
            <ChevronRight size={12} strokeWidth={2.4} />
          </span>
        </>
      )}
    </div>
  );
});

/** Filmstrip tiles sampled from the clip's source range out of one sprite image. */
function Film({ clip, media, assets, width, pps, height }: { clip: Clip; media: MediaItem; assets: MediaAssets; width: number; pps: number; height: number }) {
  const tileH = Math.max(16, height);
  const tileW = Math.round((tileH * assets.stripFrameW) / assets.stripFrameH);
  if (media.kind === "image") {
    if (!assets.thumb) return null;
    return <div className="clip-film" style={{ backgroundImage: `url("${fileSrc(assets.thumb)}")`, backgroundSize: `auto ${tileH}px`, height: tileH }} />;
  }
  if (!assets.strip || assets.stripCount < 1) return null;
  const count = Math.min(MAX_TILES, Math.max(1, Math.ceil(width / tileW)));
  const shownW = Math.max(tileW, width / count);
  const sprite = fileSrc(assets.strip);
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const t = clip.in + ((i + 0.5) * shownW * clip.speed) / pps;
    const frame = Math.min(assets.stripCount - 1, Math.max(0, Math.floor((t / Math.max(0.001, media.duration)) * assets.stripCount)));
    tiles.push(
      <span
        key={i}
        style={{
          width: shownW,
          backgroundImage: `url("${sprite}")`,
          backgroundSize: `${assets.stripCount * shownW}px auto`,
          backgroundPosition: `-${frame * shownW}px center`,
        }}
      />,
    );
  }
  return (
    <div className="clip-film" style={{ height: tileH }}>
      {tiles}
    </div>
  );
}

/** Waveform PNG used as a mask, positioned so only the clip's source range shows. */
function Wave({ clip, media, wave, width, pps, compact }: { clip: Clip; media: MediaItem; wave: string; width: number; pps: number; compact: boolean }) {
  const full = (media.duration / clip.speed) * pps;
  const offset = (clip.in / clip.speed) * pps;
  const url = `url("${fileSrc(wave)}")`;
  return (
    <div
      className={`clip-wave${compact ? " compact" : ""}`}
      style={{
        width,
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: `${full}px 100%`,
        WebkitMaskSize: `${full}px 100%`,
        maskPosition: `-${offset}px 0`,
        WebkitMaskPosition: `-${offset}px 0`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}

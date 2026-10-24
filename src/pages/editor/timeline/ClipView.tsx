import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { fileSrc } from "../../../lib/backend";
import { clipDuration, updateClip } from "../../../project/ops";
import type { Clip, MediaAssets, MediaItem, Project, TrackKind } from "../../../project/types";
import { useAssets } from "../../../store/assets";
import { ChevronLeft, ChevronRight, Sparkles, Type } from "lucide-react";
import { EFFECT_DEF } from "../../../project/effects";
import { useEditorUi } from "../../../store/editorUi";
import { useProject } from "../../../store/project";
import { engine } from "../../../engine/playback";
import { t, type Key } from "../../../i18n";
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
      {selected && <FxRangeBar clip={clip} pps={pps} />}
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

/** A text clip: a teal pill that shows its words. */
export const TextClipView = memo(function TextClipView({ clip, pps, selected }: { clip: Clip; pps: number; selected: boolean }) {
  const duration = clipDuration(clip);
  const width = Math.max(2, duration * pps);
  const label = (clip.text?.content ?? "").replace(/\s+/g, " ").trim();
  return (
    <div
      className={`clip tone-text${selected ? " selected" : ""}${width < 36 ? " tiny" : ""}`}
      style={{ transform: `translateX(${clip.start * pps}px)`, width }}
      data-clip-id={clip.id}
      title={label}
      onPointerDown={(e) => beginClipDrag(e, clip.id, "move")}
    >
      <div className="clip-body">
        <div className="clip-label">
          <Type className="clip-text-glyph" />
          <span>{label || "…"}</span>
        </div>
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

/** An effect layer: a pill on an "effect" track that applies its effects to everything below it. */
export const EffectLayerView = memo(function EffectLayerView({ clip, pps, selected }: { clip: Clip; pps: number; selected: boolean }) {
  const duration = clipDuration(clip);
  const width = Math.max(2, duration * pps);
  const label = (clip.effects ?? []).map((e) => (EFFECT_DEF[e.kind] ? t(`fx.${e.kind}` as Key) : e.kind)).join(" · ");
  return (
    <div
      className={`clip tone-fx${selected ? " selected" : ""}${width < 36 ? " tiny" : ""}`}
      style={{ transform: `translateX(${clip.start * pps}px)`, width }}
      data-clip-id={clip.id}
      title={label}
      onPointerDown={(e) => beginClipDrag(e, clip.id, "move")}
    >
      <div className="clip-body">
        <div className="clip-label">
          <Sparkles className="clip-text-glyph" />
          <span>{label || t("fx.layer")}</span>
        </div>
      </div>
      {selected && <FxRangeBar clip={clip} pps={pps} />}
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

const MIN_FX = 0.1;

/** Range of the focused effect drawn over the selected clip, with draggable edges and body. */
function FxRangeBar({ clip, pps }: { clip: Clip; pps: number }) {
  const focus = useEditorUi((s) => s.fxFocus);
  if (!focus || focus.clipId !== clip.id) return null;
  const fx = clip.effects?.[focus.index];
  if (!fx) return null;
  const length = clipDuration(clip);
  const a = Math.max(0, Math.min(length, fx.from ?? 0));
  const b = Math.max(a, Math.min(length, fx.to ?? length));
  const begin = (e: ReactPointerEvent, mode: "start" | "end" | "move") => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const store = useProject.getState();
    store.beginGesture();
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / pps;
      let na = a;
      let nb = b;
      if (mode === "start") na = Math.min(b - MIN_FX, Math.max(0, a + d));
      else if (mode === "end") nb = Math.max(a + MIN_FX, Math.min(length, b + d));
      else {
        const sh = Math.max(-a, Math.min(length - b, d));
        na = a + sh;
        nb = b + sh;
      }
      const r = (v: number) => Math.round(v * 100) / 100;
      store.transient((p) => setEffectRange(p, clip.id, focus.index, r(na), r(nb), length));
      engine.seek(clip.start + (mode === "end" ? nb : na));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      store.endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="fx-range" style={{ left: a * pps, width: Math.max(4, (b - a) * pps) }} onPointerDown={(e) => begin(e, "move")}>
      <span className="fx-range-label">{t(`fx.${fx.kind}` as Key)}</span>
      <span className="fx-range-h start" onPointerDown={(e) => begin(e, "start")} />
      <span className="fx-range-h end" onPointerDown={(e) => begin(e, "end")} />
    </div>
  );
}

/** Set an effect's range; a range covering the whole clip is stored as "whole clip" (no bounds). */
export function setEffectRange(p: Project, clipId: string, index: number, from: number, to: number, length: number): Project {
  const whole = from <= 0.005 && to >= length - 0.005;
  const clip = p.clips.find((c) => c.id === clipId);
  if (!clip) return p;
  const effects = (clip.effects ?? []).map((e, i) => (i !== index ? e : whole ? { kind: e.kind, amount: e.amount } : { ...e, from, to }));
  return updateClip(p, clipId, { effects });
}

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

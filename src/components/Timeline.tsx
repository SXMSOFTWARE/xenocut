import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { ClipStrip } from "./ClipStrip";
import { useMedia } from "../context/MediaContext";
import { formatTimestamp, rulerMarks } from "../lib/time";
import { useEditorStore } from "../store/editorStore";

export function Timeline() {
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const duration = useEditorStore((state) => state.duration);
  const currentTime = useEditorStore((state) => state.currentTime);
  const clips = useEditorStore((state) => state.clips);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const importing = useEditorStore((state) => state.importing);
  const selectClip = useEditorStore((state) => state.selectClip);
  const seek = useMedia().seek;
  const openFilePicker = useMedia().openFilePicker;

  useEffect(() => {
    const node = scaleRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  const ratio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const marks = rulerMarks(duration, width);

  const scrubTo = (clientX: number) => {
    const node = scaleRef.current;
    if (!node || duration <= 0) return;
    const rect = node.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * duration;
    seek(next);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-trim]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    scrubTo(event.clientX);
  };

  const onTrimStart = (edge: "start" | "end", event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const clipId = selectedClipId;
    if (!clipId) return;
    const clip = useEditorStore.getState().clips.find((item) => item.id === clipId);
    const node = scaleRef.current;
    if (!clip || !node) return;
    const origin = edge === "start" ? clip.start : clip.end;
    const originX = event.clientX;
    const track = node.clientWidth || 1;
    const total = useEditorStore.getState().duration;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (pointer: PointerEvent) => {
      const delta = ((pointer.clientX - originX) / track) * total;
      useEditorStore.getState().trimClip(clipId, edge, origin + delta);
    };
    const up = (pointer: PointerEvent) => {
      event.currentTarget.releasePointerCapture(pointer.pointerId);
      event.currentTarget.removeEventListener("pointermove", move);
      event.currentTarget.removeEventListener("pointerup", up);
    };
    event.currentTarget.addEventListener("pointermove", move);
    event.currentTarget.addEventListener("pointerup", up);
  };

  return (
    <div className="timeline" data-testid="timeline">
      <div className="timeline-body">
        <div
          ref={scaleRef}
          className="timeline-scale"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
        >
          <div
            className="scrubber"
            role="slider"
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatTimestamp(currentTime)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") seek(currentTime - 1);
              if (event.key === "ArrowRight") seek(currentTime + 1);
            }}
          >
            <div className="scrub-line" />
            <span className="scrub-dot left" />
            <span className="scrub-dot right" />
            <div
              className="scrub-handle"
              style={{ left: `clamp(19px, ${ratio * 100}%, calc(100% - 19px))` }}
            >
              <ChevronLeft size={12} strokeWidth={2.4} />
              <ChevronRight size={12} strokeWidth={2.4} style={{ marginLeft: -4 }} />
            </div>
          </div>
          <div className="ruler" aria-hidden="true">
            {importing && (
              <span className="ruler-label" style={{ left: 0 }}>
                Reading frames
              </span>
            )}
            {!importing &&
              marks.map((mark) => {
                const left = `${(mark.time / duration) * 100}%`;
                if (mark.kind === "dot") {
                  return <span key={`dot-${mark.time}`} className="ruler-dot" style={{ left }} />;
                }
                const translate =
                  mark.time <= 0.001 ? "translateX(0)" : Math.abs(mark.time - duration) < 0.05 ? "translateX(-100%)" : "translateX(-50%)";
                return (
                  <span key={`label-${mark.time}`} className="ruler-label" style={{ left, transform: translate }}>
                    {formatTimestamp(mark.time)}
                  </span>
                );
              })}
          </div>
          <div className="clip-row">
            {clips.map((clip) => (
              <ClipStrip
                key={clip.id}
                clip={clip}
                duration={duration}
                selected={clip.id === selectedClipId}
                onSelect={selectClip}
                onTrimStart={onTrimStart}
              />
            ))}
            <div className="playhead" style={{ left: `${ratio * 100}%` }} />
          </div>
        </div>
        <button type="button" className="add-clip" aria-label="Import video" onClick={openFilePicker}>
          <Plus size={15} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

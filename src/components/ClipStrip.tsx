import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PointerEvent } from "react";
import { HERO } from "../data/demo";
import type { Clip } from "../types";

interface ClipStripProps {
  clip: Clip;
  duration: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onTrimStart: (edge: "start" | "end", event: PointerEvent<HTMLButtonElement>) => void;
}

export function ClipStrip({ clip, duration, selected, onSelect, onTrimStart }: ClipStripProps) {
  const length = Math.max(duration, 0.001);
  const thumbs = clip.thumbnails.length > 0 ? clip.thumbnails : [HERO];

  return (
    <div
      className={`clip-strip tint-${clip.tint}${selected ? " is-selected" : ""}`}
      style={{
        left: `calc(${(clip.start / length) * 100}% + 3px)`,
        width: `max(16px, calc(${((clip.end - clip.start) / length) * 100}% - 6px))`,
      }}
      onPointerDown={() => onSelect(clip.id)}
      title={`${clip.tint} clip`}
    >
      <div className="clip-thumbs">
        {thumbs.map((src, index) => (
          <div key={`${src}-${index}`} className="clip-thumb" style={{ backgroundImage: `url("${src}")` }} />
        ))}
      </div>
      <div className="clip-tint" />
      {selected && (
        <>
          <button
            type="button"
            className="trim-btn left"
            data-trim="start"
            aria-label="Trim clip start"
            onPointerDown={(event) => onTrimStart("start", event)}
          >
            <ChevronLeft size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="trim-btn right"
            data-trim="end"
            aria-label="Trim clip end"
            onPointerDown={(event) => onTrimStart("end", event)}
          >
            <ChevronRight size={12} strokeWidth={2.4} />
          </button>
        </>
      )}
    </div>
  );
}

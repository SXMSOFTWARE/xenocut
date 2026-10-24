import { useEffect, useRef } from "react";
import { perfSkip } from "../../../lib/perfSkip";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { engine } from "../../../engine/playback";
import { usePlayback } from "../../../store/playback";

/** Thin overview seeker spanning the whole project, with the reference's white "< >" handle. */
export function Scrubber({ duration }: { duration: number }) {
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const total = Math.max(duration, 0.001);

  useEffect(() => {
    const place = (time: number) => {
      const f = Math.min(1, Math.max(0, time / total));
      if (handle.current) handle.current.style.left = `${f * 100}%`;
      if (fill.current) fill.current.style.width = `${f * 100}%`;
    };
    place(usePlayback.getState().time);
    return usePlayback.subscribe((s, prev) => s.time !== prev.time && !perfSkip.has("sc") && place(s.time));
  }, [total]);

  const seekAt = (x: number) => {
    const rect = track.current!.getBoundingClientRect();
    engine.seek(((x - rect.left) / Math.max(1, rect.width)) * total);
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || duration <= 0) return;
    engine.pause();
    seekAt(e.clientX);
    const move = (ev: PointerEvent) => seekAt(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="scrubber" onPointerDown={down}>
      <div className="scrubber-track" ref={track}>
        <div className="scrubber-fill" ref={fill} />
        <div className="scrubber-handle" ref={handle}>
          <ChevronLeft size={11} strokeWidth={2.6} />
          <ChevronRight size={11} strokeWidth={2.6} />
        </div>
      </div>
    </div>
  );
}

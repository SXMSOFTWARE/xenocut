import { useEffect, useRef } from "react";
import { usePlayback } from "../../../store/playback";
import { useEditorUi } from "../../../store/editorUi";
import { engine } from "../../../engine/playback";

/**
 * Positioned imperatively from the playback store, so playback never re-renders the timeline.
 * While playing it keeps itself in view by paging the scroller.
 */
export function Playhead({ pps, scroller, headerWidth }: { pps: number; scroller: HTMLDivElement | null; headerWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const place = (time: number, playing: boolean) => {
      const x = time * pps;
      if (ref.current) {
        ref.current.style.transform = `translateX(${x}px)`;
        // Hide while it would sit underneath the sticky track headers.
        ref.current.style.visibility = scroller && x < scroller.scrollLeft - 1 ? "hidden" : "";
      }
      if (playing && scroller) {
        const view = scroller.clientWidth - headerWidth;
        const rel = x - scroller.scrollLeft;
        if (rel > view - 40 || rel < 0) scroller.scrollLeft = Math.max(0, x - 40);
      }
    };
    const onScroll = () => {
      place(usePlayback.getState().time, false);
      if (grip.current && scroller) grip.current.style.transform = `translateY(${scroller.scrollTop}px)`;
    };
    onScroll();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    const unsub = usePlayback.subscribe((next) => place(next.time, next.playing));
    return () => {
      unsub();
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [pps, scroller, headerWidth]);

  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0 || !scroller) return;
    e.stopPropagation();
    engine.pause();
    const move = (ev: PointerEvent) => {
      const rect = scroller.getBoundingClientRect();
      const x = ev.clientX - rect.left - headerWidth + scroller.scrollLeft;
      engine.seek(x / useEditorUi.getState().pxPerSec);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="playhead" ref={ref}>
      <div className="playhead-grip" ref={grip} onPointerDown={grab} />
      <div className="playhead-line" />
    </div>
  );
}

export function SnapLine({ pps }: { pps: number }) {
  const line = useEditorUi((s) => s.snapLine);
  if (line === null) return null;
  return <div className="snap-line" style={{ transform: `translateX(${line * pps}px)` }} />;
}

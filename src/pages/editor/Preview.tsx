import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { engine } from "../../engine/playback";
import { useT } from "../../i18n";
import { timecode } from "../../lib/format";
import { projectDuration } from "../../project/ops";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";

export function Preview() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useProject((s) => s.project?.settings.width ?? 1920);
  const height = useProject((s) => s.project?.settings.height ?? 1080);
  const empty = useProject((s) => (s.project?.clips.length ?? 0) === 0);
  const playing = usePlayback((s) => s.playing);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    engine.attach(videoRef.current!, imageRef.current!);
    return () => engine.detach();
  }, []);

  useLayoutEffect(() => {
    const area = areaRef.current!;
    const fit = () => {
      const aw = area.clientWidth;
      const ah = area.clientHeight;
      const scale = Math.min(aw / width, ah / height);
      setBox({ w: Math.floor(width * scale), h: Math.floor(height * scale) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <section className="preview">
      <div className="preview-area" ref={areaRef}>
        <div className="stage" style={{ width: box.w, height: box.h }} onClick={() => engine.toggle()}>
          <video ref={videoRef} className="stage-media" playsInline />
          <img ref={imageRef} className="stage-media" alt="" draggable={false} />
          {empty && <div className="stage-empty">{t("preview.empty")}</div>}
        </div>
      </div>
      <div className="transport">
        <TimeReadout />
        <div className="transport-buttons">
          <button className="icon-btn flat" onClick={() => engine.seek(0)} title={t("preview.start")} aria-label={t("preview.start")}>
            <SkipBack />
          </button>
          <button className="icon-btn flat" onClick={() => engine.step(-1)} title={t("preview.prevFrame")} aria-label={t("preview.prevFrame")}>
            <StepBack />
          </button>
          <button className="icon-btn lg primary" onClick={() => engine.toggle()} title={`${t("preview.play")} (Space)`} aria-label={t("preview.play")}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button className="icon-btn flat" onClick={() => engine.step(1)} title={t("preview.nextFrame")} aria-label={t("preview.nextFrame")}>
            <StepForward />
          </button>
          <button className="icon-btn flat" onClick={() => engine.seek(engine.duration())} title={t("preview.end")} aria-label={t("preview.end")}>
            <SkipForward />
          </button>
        </div>
        <span className="transport-meta muted tnum">
          {width}×{height}
        </span>
      </div>
    </section>
  );
}

/** Updates through a ref: the playhead never re-renders React components while playing. */
function TimeReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  const fps = useProject((s) => s.project?.settings.fps ?? 30);
  const duration = useProject((s) => (s.project ? projectDuration(s.project) : 0));
  useEffect(() => {
    const paint = (time: number) => {
      if (ref.current) ref.current.textContent = timecode(time, fps);
    };
    paint(usePlayback.getState().time);
    return usePlayback.subscribe((s, prev) => s.time !== prev.time && paint(s.time));
  }, [fps]);
  return (
    <span className="timecode tnum">
      <span ref={ref} className="now" />
      <span className="sep">/</span>
      <span className="total">{timecode(duration, fps)}</span>
    </span>
  );
}

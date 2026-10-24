import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { engine } from "../../engine/playback";
import { useT } from "../../i18n";
import { gradeFilter, tintDefs } from "../../project/grade";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useAssets } from "../../store/assets";
import { useSettings } from "../../store/settings";

/**
 * The project canvas, letterboxed (contain) into whatever room the hero leaves between the rail,
 * the floating panel and the timeline overlay. It never collapses to zero: the area has min sizes
 * and the fit is recomputed on every resize.
 */
export function Preview() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useProject((s) => s.project?.settings.width ?? 1920);
  const height = useProject((s) => s.project?.settings.height ?? 1080);
  const grade = useProject((s) => s.project?.settings.grade);
  const empty = useProject((s) => (s.project?.clips.length ?? 0) === 0);
  const mediaError = usePlayback((s) => s.mediaError);
  const lite = useSettings((s) => s.performanceMode);
  const proxyOn = useSettings((s) => s.previewProxy);
  const media = useProject((s) => s.project?.media);
  const proxies = useAssets((s) => s.proxies);
  // Performance mode skips the live colour grade (a per-frame CSS filter); exports still apply it.
  const liveGrade = grade && grade !== "none" && !lite ? gradeFilter(grade) : undefined;

  useEffect(() => {
    if (!proxyOn || !media) return;
    for (const m of media) useAssets.getState().requestProxy(m);
  }, [proxyOn, media]);

  // Swap sources when a proxy finishes or the option is toggled.
  useEffect(() => {
    engine.seek(usePlayback.getState().time);
  }, [proxyOn, proxies]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    engine.attach(videoRef.current!, imageRef.current!);
    return () => engine.detach();
  }, []);

  useLayoutEffect(() => {
    const area = areaRef.current!;
    const fit = () => {
      const aw = Math.max(32, area.clientWidth);
      const ah = Math.max(32, area.clientHeight);
      const scale = Math.min(aw / width, ah / height);
      setBox({ w: Math.max(16, Math.floor(width * scale)), h: Math.max(16, Math.floor(height * scale)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div className="stage-area" ref={areaRef}>
      <div className="stage" style={{ width: box.w, height: box.h, filter: liveGrade }} onClick={() => engine.toggle()}>
        <video ref={videoRef} className="stage-media" playsInline />
        <img ref={imageRef} className="stage-media" alt="" draggable={false} />
        {empty && <div className="stage-empty">{t("preview.empty")}</div>}
      </div>
      {mediaError && (
        <div className="stage-error" role="alert" style={{ width: box.w }}>
          <strong>{t("preview.mediaError")}</strong>
          <span>{mediaError}</span>
        </div>
      )}
      <svg className="svg-defs" aria-hidden="true" width="0" height="0">
        {tintDefs().map((d) => (
          <filter key={d.id} id={d.id} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={d.matrix} />
          </filter>
        ))}
      </svg>
    </div>
  );
}

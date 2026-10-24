import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLongPress } from "../../components/ContextMenu";
import { previewMenu } from "./menus";
import { perfSkip } from "../../lib/perfSkip";
import { engine, type FxOverlays } from "../../engine/playback";
import { useT } from "../../i18n";
import { gradeFilter, tintDefs } from "../../project/grade";
import { temperatureMatrix, temperatureValues } from "../../project/effects";
import { PRESET_TEMPERATURES } from "../../project/presets";
import { usePlayback } from "../../store/playback";
import { useProject } from "../../store/project";
import { useAssets } from "../../store/assets";
import { useSettings } from "../../store/settings";
import { useEditorUi } from "../../store/editorUi";
import { updateLottie, updateText } from "../../project/ops";
import { fontsFor } from "../../text/exportLayer";
import { activeLayers, layerBox, textAtPoint } from "../../text/render";

/**
 * The project canvas, letterboxed (contain) into whatever room the hero leaves between the rail,
 * the floating panel and the timeline overlay. It never collapses to zero: the area has min sizes
 * and the fit is recomputed on every resize.
 */
export function Preview() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const lutRef = useRef<HTMLCanvasElement>(null);
  const nativeRef = useRef<HTMLCanvasElement>(null);
  const spareRef = useRef<HTMLVideoElement>(null);
  const trRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const layerFxRef = useRef<HTMLDivElement>(null);
  const layerPicRef = useRef<HTMLDivElement>(null);
  const clipFxRef = useRef<HTMLDivElement>(null);
  const clipOvRef = useRef<HTMLDivElement>(null);
  const layerOvRef = useRef<HTMLDivElement>(null);
  const fxSvgRef = useRef<SVGFilterElement>(null);
  const fxSvg2Ref = useRef<SVGFilterElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggedRef = useRef(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const width = useProject((s) => s.project?.settings.width ?? 1920);
  const height = useProject((s) => s.project?.settings.height ?? 1080);
  const grade = useProject((s) => s.project?.settings.grade);
  const empty = useProject((s) => (s.project?.clips.length ?? 0) === 0);
  const mediaError = usePlayback((s) => s.mediaError);
  const converting = usePlayback((s) => s.mediaConverting);
  const lite = useSettings((s) => s.performanceMode);
  const proxyOn = useSettings((s) => s.previewProxy);
  const media = useProject((s) => s.project?.media);
  const proxies = useAssets((s) => s.proxies);
  const temps = useProject((s) => [...new Set([...(s.project ? temperatureValues(s.project.clips) : []), ...PRESET_TEMPERATURES])].join(","));
  // Performance mode skips the live colour grade (a per-frame CSS filter); exports still apply it.
  const liveGrade = grade && grade !== "none" && !lite ? gradeFilter(grade) : undefined;

  useEffect(() => {
    if (!media) return;
    for (const m of media) void useAssets.getState().requestProxy(m);
  }, [proxyOn, media]);

  // Swap sources when a proxy finishes or the option is toggled.
  useEffect(() => {
    engine.seek(usePlayback.getState().time);
  }, [proxyOn, proxies]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    engine.attach(videoRef.current!, imageRef.current!);
    engine.attachText(textRef.current);
    engine.attachNative(nativeRef.current);
    engine.attachLut(lutRef.current);
    engine.attachTransition(spareRef.current, trRef.current);
    engine.attachFx({
      layer: layerFxRef.current!,
      layerPicture: layerPicRef.current!,
      clip: clipFxRef.current!,
      clipOverlays: overlaysIn(clipOvRef.current!),
      layerOverlays: overlaysIn(layerOvRef.current!),
      svg: fxSvgRef.current!,
      svg2: fxSvg2Ref.current!,
    });
    return () => {
      engine.attachFx(null);
      engine.attachNative(null);
      engine.attachLut(null);
      engine.detach();
    };
  }, []);

  // Text canvas backing store follows the on-screen size (capped for speed in performance mode).
  useLayoutEffect(() => {
    const canvas = textRef.current;
    if (!canvas || !box.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 2);
    const w = Math.round(box.w * dpr);
    const h = Math.round(box.h * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    engine.invalidateText();
  }, [box.w, box.h, lite]);

  // Load the fonts the text clips use, then redraw with them.
  const fontKey = useProject((s) =>
    (s.project?.clips ?? [])
      .filter((c) => c.text)
      .map((c) => `${c.text!.style.font}/${c.text!.style.weight}/${c.text!.style.italic ? 1 : 0}`)
      .sort()
      .join(","),
  );
  useEffect(() => {
    const p = useProject.getState().project;
    if (!p || !fontKey) return;
    let live = true;
    void fontsFor(p).then(() => live && engine.invalidateText());
    return () => {
      live = false;
    };
  }, [fontKey]);

  /** Grab a text clip on the stage: select it, and drag to move it. */
  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    const project = useProject.getState().project;
    const stage = stageRef.current;
    if (e.button !== 0 || !project || !stage) return;
    const rect = stage.getBoundingClientRect();
    const toProject = (cx: number, cy: number) => ({
      x: ((cx - rect.left) / rect.width) * project.settings.width,
      y: ((cy - rect.top) / rect.height) * project.settings.height,
    });
    const time = usePlayback.getState().time;
    const start = toProject(e.clientX, e.clientY);
    const id = textAtPoint(project, time, start.x, start.y);
    if (!id) return;
    const clip = project.clips.find((c) => c.id === id);
    const pos = clip?.text?.style ?? clip?.lottie;
    if (!clip || !pos) return;
    engine.pause();
    draggedRef.current = true; // a press on text never toggles playback
    useProject.getState().select([id]);
    useEditorUi.setState({ panel: clip.lottie ? "stickers" : "text" });
    const origin = { x: pos.x, y: pos.y };
    const { beginGesture, endGesture, transient } = useProject.getState();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const now = toProject(ev.clientX, ev.clientY);
      const dx = (now.x - start.x) / project.settings.width;
      const dy = (now.y - start.y) / project.settings.height;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      if (!moved) beginGesture();
      moved = true;
      let x = Math.min(1, Math.max(0, origin.x + dx));
      let y = Math.min(1, Math.max(0, origin.y + dy));
      // Snap to the centre lines.
      if (Math.abs(x - 0.5) < 0.012) x = 0.5;
      if (Math.abs(y - 0.5) < 0.012) y = 0.5;
      transient((p) => (clip.lottie ? updateLottie(p, id, { x, y }) : updateText(p, id, (tx) => ({ ...tx, style: { ...tx.style, x, y } }))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useLayoutEffect(() => {
    const area = areaRef.current!;
    const fit = () => {
      // clientWidth includes padding (themes pad the docked stage): fit inside the content box.
      const cs = getComputedStyle(area);
      const px = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const py = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const aw = Math.max(32, area.clientWidth - px);
      const ah = Math.max(32, area.clientHeight - py);
      const scale = Math.min(aw / width, ah / height);
      setBox({ w: Math.max(16, Math.floor(width * scale)), h: Math.max(16, Math.floor(height * scale)) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(area);
    return () => ro.disconnect();
  }, [width, height]);

  // Blur and RGB split are sized in on-screen pixels: redraw the paused frame after a resize.
  useEffect(() => {
    if (box.h && !usePlayback.getState().playing) engine.seek(usePlayback.getState().time);
  }, [box.h]);

  const stageMenu = useLongPress(previewMenu);

  return (
    <div className="stage-area" ref={areaRef}>
      <div
        ref={stageRef}
        className="stage"
        style={{ width: box.w, height: box.h }}
        {...stageMenu}
        onPointerDown={onStagePointerDown}
        onClick={() => {
          if (!draggedRef.current) engine.toggle();
          draggedRef.current = false;
        }}
      >
        <div ref={layerRef} className="stage-layer" style={{ filter: liveGrade }}>
          {/* Effect layers wrap the clip: their filter and overlays apply to everything below. */}
          <div ref={layerFxRef} className="stage-fxwrap">
            <div ref={layerPicRef} className="stage-fxwrap stage-fxpic">
              <div ref={clipFxRef} className="stage-fxwrap">
                <video ref={videoRef} className="stage-media" playsInline />
                <img ref={imageRef} className="stage-media" alt="" draggable={false} />
                <video ref={spareRef} className="stage-media" playsInline muted aria-hidden />
                <canvas ref={nativeRef} className="stage-media stage-native" aria-hidden />
                <canvas ref={lutRef} className="stage-media stage-lut" aria-hidden />
                <canvas ref={trRef} className="stage-media stage-tr" aria-hidden />
                <div ref={clipOvRef} className="stage-ov">
                  <FxOverlayElements />
                </div>
              </div>
            </div>
            <div ref={layerOvRef} className="stage-ov stage-ov-full">
              <FxOverlayElements />
            </div>
          </div>
        </div>
        <canvas ref={textRef} className="stage-text" aria-hidden="true" />
        <TextSelection width={width} height={height} />
        {empty && <div className="stage-empty">{t("preview.empty")}</div>}
      </div>
      {converting && !mediaError && (
        <div className="stage-error stage-notice" role="status" style={{ width: box.w }}>
          <strong>{t("preview.converting")}</strong>
          <span>{t("preview.convertingHint", { name: converting })}</span>
        </div>
      )}
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
        {temps
          .split(",")
          .filter(Boolean)
          .map((v) => (
            <filter key={v} id={`xc-fx-temp-${v}`} colorInterpolationFilters="sRGB">
              <feColorMatrix type="matrix" values={temperatureMatrix(Number(v))} />
            </filter>
          ))}
        <filter ref={fxSvgRef} id="xc-fx-svg" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%" />
        <filter ref={fxSvg2Ref} id="xc-fx-svg2" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%" />
      </svg>
    </div>
  );
}

/** The overlay elements the engine paints (see `FxOverlays`), in the export's order. */
function FxOverlayElements() {
  return (
    <>
      <div className="stage-fx" data-ov="vignette" />
      <div className="stage-fx stage-grain" data-ov="grain" />
      <div className="stage-fx" data-ov="scanlines" />
      <div className="stage-fx stage-flash" data-ov="flash" />
      <div className="stage-fx stage-dip" data-ov="dip" />
      <div className="stage-fx" data-ov="letterbox" />
    </>
  );
}

function overlaysIn(box: HTMLElement): FxOverlays {
  const get = (name: string) => box.querySelector<HTMLElement>(`[data-ov="${name}"]`)!;
  return { box, vignette: get("vignette"), grain: get("grain"), scanlines: get("scanlines"), flash: get("flash"), dip: get("dip"), letterbox: get("letterbox") };
}

/** Dashed box around the selected text clip while it is on screen. */
function TextSelection({ width, height }: { width: number; height: number }) {
  const time = usePlayback((s) => (perfSkip.has("pv") ? 0 : s.time));
  const playing = usePlayback((s) => s.playing);
  const project = useProject((s) => s.project);
  const selection = useProject((s) => s.selection);
  if (!project || playing || selection.length !== 1) return null;
  const active = activeLayers(project, time).find((a) => a.clip.id === selection[0]);
  const b = active && layerBox(active.clip, width, height);
  if (!b) return null;
  return (
    <div
      className="stage-text-box"
      style={{ left: `${(b.left / width) * 100}%`, top: `${(b.top / height) * 100}%`, width: `${(b.w / width) * 100}%`, height: `${(b.h / height) * 100}%` }}
    />
  );
}

// Hidden self-test, enabled only by the XENOCUT_AUTOTEST=<media file> environment variable.
// Imports the file into a fresh project, plays it and logs what the <video> element reports,
// so playback can be verified on a headless machine (Xvfb) from the log file.
import { engine, setSilent } from "../engine/playback";
import { openMediaAsProject } from "../project/actions";
import { usePlayback } from "../store/playback";
import { log, transport } from "./backend";
import { perfCounters } from "./perfHook";
import { useProject } from "../store/project";
import { useSettings } from "../store/settings";
import { useEditorUi } from "../store/editorUi";
import { useRouter, type Page } from "../store/router";
import { useAssets } from "../store/assets";
import type { Grade } from "../project/grade";
import { addTextClip, projectDuration, updateClip } from "../project/ops";
import type { EffectKind } from "../project/effects";
import { textFromPreset } from "../project/text";
import { renderTextLayer, discardTextLayer } from "../text/exportLayer";
import { api } from "./backend";
import { maxCharsFor, setSubtitles } from "../project/subtitles";
import { useSubtitleJob } from "../store/subtitleJob";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function snapshot(tag: string) {
  const v = document.querySelector<HTMLVideoElement>("video.stage-media");
  if (!v) return log("autotest", `${tag}: no <video> element`);
  const r = v.getBoundingClientRect();
  const stage = v.parentElement?.getBoundingClientRect();
  const state = {
    tag,
    src: v.currentSrc.replace(/\/[0-9a-f]{64}\//, "/<token>/"),
    readyState: v.readyState,
    networkState: v.networkState,
    currentTime: Number(v.currentTime.toFixed(3)),
    duration: v.duration,
    paused: v.paused,
    muted: v.muted,
    volume: v.volume,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    error: v.error ? { code: v.error.code, message: v.error.message } : null,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    stage: stage && { w: Math.round(stage.width), h: Math.round(stage.height) },
    visibility: v.style.visibility,
    timeline: Number(usePlayback.getState().time.toFixed(3)),
    playing: usePlayback.getState().playing,
    mediaError: usePlayback.getState().mediaError,
  };
  log("autotest", JSON.stringify(state));
  return state;
}

export async function runAutotest(file: string) {
  setSilent(true);
  log("autotest", `start ${file}`);
  await sleep(800);
  if (await pageProbe()) return;
  const ok = await openMediaAsProject(file, "Autotest");
  log("autotest", `project opened: ${ok}`);
  for (let i = 0; i < 50 && !document.querySelector("video.stage-media"); i++) await sleep(200);
  await sleep(2000);
  const before = snapshot("before-play");
  engine.play();
  let last = before;
  for (let i = 1; i <= 6; i++) {
    await sleep(1000);
    last = snapshot(`playing+${i}s`);
  }
  const advanced = before && last ? last.currentTime - before.currentTime : 0;
  const pass = !!last && advanced > 2 && last.readyState >= 2 && last.videoWidth > 0 && !last.error;
  log("autotest", `RESULT ${pass ? "PASS" : "FAIL"} currentTime advanced ${advanced.toFixed(2)}s`);
  // Pause on a frame so a screenshot shows a stable picture.
  engine.pause();
  snapshot("paused");
  await textProbe();
  await subsProbe();
  await fxProbe();
  await perfProbe();
}

/** fx=blur:30+vignette:60[,at=2][,export=out.mp4]: puts effects on the first video clip. */
async function fxProbe() {
  const o = opts();
  if (!o.fx) return;
  const effects = o.fx.split("+").map((part) => {
    const [kind, amount] = part.split(":");
    return { kind: kind as EffectKind, amount: amount === undefined ? 1 : Number(amount) / 100 };
  });
  const project = useProject.getState().project!;
  const clip = project.clips.find((c) => project.tracks.find((t) => t.id === c.trackId)?.kind === "video" && !c.text);
  if (!clip) return log("autotest", "FX no clip");
  useProject.getState().commit((p) => updateClip(p, clip.id, { effects }));
  useProject.getState().select([clip.id]);
  useEditorUi.setState({ panel: "effects" });
  engine.seek(Number(o.at ?? 2));
  await sleep(1500);
  log("autotest", `FX ${JSON.stringify({ effects, filter: (document.querySelector("video.stage-media") as HTMLElement | null)?.style.filter, transform: (document.querySelector(".stage-layer") as HTMLElement | null)?.style.transform })}`);
  document.querySelector(".fx-section")?.scrollIntoView({ block: "start" });
  await sleep(300);
  log("autotest", "fx-ready");
  await sleep(800);
  await exportProbe(o.export);
}

/** page=settings[,scroll=bottom][,click=.selector]: shows a page instead of the editor run; logs "page-ready". */
async function pageProbe(): Promise<boolean> {
  const o = opts();
  if (!o.page) return false;
  useRouter.getState().go(o.page as Page);
  await sleep(1200);
  if (o.click) (document.querySelector(o.click) as HTMLElement | null)?.click();
  await sleep(300);
  if (o.scroll === "bottom") document.querySelectorAll("*").forEach((el) => el.scrollHeight > el.clientHeight + 4 && (el.scrollTop = el.scrollHeight));
  await sleep(600);
  log("autotest", "page-ready");
  return true;
}

async function rafRate(ms: number): Promise<number> {
  let n = 0;
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const f = () => (++n, performance.now() - t0 < ms ? requestAnimationFrame(f) : done());
    requestAnimationFrame(f);
  });
  return +((n * 1000) / (performance.now() - t0)).toFixed(1);
}

function opts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (transport.autotestOpts ?? "").split(",")) {
    const [k, v] = kv.split("=");
    if (k) out[k.trim()] = (v ?? "1").trim();
  }
  return out;
}

/** Plays from the start for N seconds and logs dropped frames, UI frame pacing and React commits. */
async function perfProbe() {
  const o = opts();
  if (!o.secs) return;
  if (o.perf !== undefined) useSettings.getState().update({ performanceMode: o.perf === "1" });
  if (o.proxy === "1") {
    useSettings.getState().update({ previewProxy: true });
    const started = performance.now();
    while (performance.now() - started < 120_000) {
      const proxies = useAssets.getState().proxies;
      if (Object.values(proxies).some((v) => v)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await log("autotest", `proxy ready ${JSON.stringify(useAssets.getState().proxies)}`);
  }
  if (o.grade) {
    const p = useProject.getState().project;
    if (p) useProject.setState({ project: { ...p, settings: { ...p.settings, grade: o.grade as Grade } } });
  }
  const EXP: Record<string, string> = {
    noradius: ".stage{border-radius:0!important;overflow:visible!important}",
    noshadow: ".stage{box-shadow:none!important}",
    noambient: ".ambient{display:none!important}",
    noopacity: "video.stage-media{opacity:1!important}",
    layer: "video.stage-media{transform:translateZ(0);will-change:transform}",
    nobars: ".editor-top,.titlebar,.bottom-bar,.rail{display:none!important}",
    plain: "body *:not(video):not(.stage):not(.stage-area):not(#root):not(#root *:has(video)){display:none!important}",
  };
  if (o.css) {
    // Free-form CSS experiment, base64url so it survives the k=v,k=v option format.
    const st = document.createElement("style");
    st.textContent = atob(o.css.replace(/-/g, "+").replace(/_/g, "/"));
    document.head.appendChild(st);
  }
  if (o.x) {
    const st = document.createElement("style");
    st.textContent = o.x.split("+").map((k) => EXP[k] ?? "").join("\n");
    document.head.appendChild(st);
  }
  if (o.collapse) useEditorUi.setState({ timelineCollapsed: true });
  if (o.hide) for (const sel of o.hide.split("+")) document.querySelectorAll<HTMLElement>(sel).forEach((el) => (el.style.display = "none"));
  await sleep(1000);
  const v = document.querySelector<HTMLVideoElement>("video.stage-media");
  if (!v) return;
  const idle = await rafRate(2000);
  engine.seek(0);
  await sleep(800);
  const secs = Number(o.secs);
  const q0 = v.getVideoPlaybackQuality?.();
  const c0 = perfCounters.commits;
  let frames = 0, janks = 0, maxGap = 0, last = performance.now(), on = true;
  const raf = (now: number) => {
    const gap = now - last;
    last = now;
    frames++;
    if (gap > 34) janks++;
    maxGap = Math.max(maxGap, gap);
    if (on) requestAnimationFrame(raf);
  };
  const t0 = performance.now();
  const vt0 = v.currentTime;
  log("autotest", "perf-start");
  engine.play();
  requestAnimationFrame((n) => ((last = n), requestAnimationFrame(raf)));
  await sleep(secs * 1000);
  on = false;
  log("autotest", "perf-end");
  const q1 = v.getVideoPlaybackQuality?.();
  const wall = (performance.now() - t0) / 1000;
  const result = {
    opts: o,
    perfClass: document.documentElement.classList.contains("perf"),
    videoSize: `${v.videoWidth}x${v.videoHeight}`,
    wall: +wall.toFixed(2),
    videoAdvanced: +(v.currentTime - vt0).toFixed(2),
    decodedFrames: q0 && q1 ? q1.totalVideoFrames - q0.totalVideoFrames : null,
    droppedFrames: q0 && q1 ? q1.droppedVideoFrames - q0.droppedVideoFrames : null,
    uiFps: +(frames / wall).toFixed(1),
    uiJanks: janks,
    uiMaxGapMs: Math.round(maxGap),
    idleUiFps: idle,
    reactCommits: perfCounters.commits - c0,
    reactCommitsPerSec: +((perfCounters.commits - c0) / wall).toFixed(1),
  };
  engine.pause();
  log("autotest", `PERF ${JSON.stringify(result)}`);
}

/** text=1: lay out two styled text clips, show the Text panel; export=<path>: render them out. */
async function textProbe() {
  const o = opts();
  if (!o.text) return;
  const { commit, select } = useProject.getState();
  let first = "";
  commit((p) => {
    const a = addTextClip(p, textFromPreset(o.preset ?? "headline", "XenoCut Başlık Ğüşİ"), 0, 4);
    first = a.clipId;
    const b = addTextClip(a.project, textFromPreset("captionPop", "words light up as they are sung"), 4, 4);
    return b.project;
  });
  select([first]);
  useEditorUi.setState({ panel: "text" });
  engine.seek(1.2);
  await sleep(1500);
  log("autotest", "text-ready");
  await sleep(1500);
  const moved = useProject.getState().project?.clips.find((c) => c.id === first)?.text?.style;
  log("autotest", `text-style ${JSON.stringify({ x: moved?.x, y: moved?.y })}`);
  engine.seek(5.5);
  await sleep(1200);
  log("autotest", "text-karaoke");
  await sleep(1000);
  await exportProbe(o.export);
}

/** subs=1[,model=base][,lang=en][,style=subtitle][,export=out.mp4]: transcribes the timeline and logs the cues. */
async function subsProbe() {
  const o = opts();
  if (!o.subs) return;
  const settings = useSettings.getState();
  settings.update({ subtitleModel: (o.model as "base") ?? "base", subtitleLanguage: o.lang ?? "auto", subtitleStyle: o.style ?? "subtitle" });
  useEditorUi.setState({ panel: "captions" });
  await sleep(800);
  const t0 = performance.now();
  const stages: string[] = [];
  const stop = useSubtitleJob.subscribe((s) => {
    if (s.running && stages[stages.length - 1] !== s.stage) stages.push(s.stage);
  });
  await useSubtitleJob.getState().run(
    useProject.getState().project!,
    { model: useSettings.getState().subtitleModel, language: useSettings.getState().subtitleLanguage, maxChars: maxCharsFor(useSettings.getState().subtitleStyle) },
    (cues, lang) => useProject.getState().commit((p) => setSubtitles(p, cues, useSettings.getState().subtitleStyle, "Subtitles", lang)),
  );
  stop();
  const job = useSubtitleJob.getState();
  const project = useProject.getState().project!;
  const subs = project.clips.filter((c) => project.tracks.find((t) => t.id === c.trackId)?.role === "subtitles");
  const cues = subs.map((c) => ({ start: +c.start.toFixed(2), end: +(c.start + c.out - c.in).toFixed(2), text: c.text?.content }));
  log("autotest", `SUBS ${JSON.stringify({ error: job.error, last: job.last, stages, ms: Math.round(performance.now() - t0), cues })}`);
  if (cues.length) engine.seek(cues[0].start + 0.6);
  await sleep(1500);
  log("autotest", "subs-ready");
  await sleep(800);
  await exportProbe(o.export);
}

async function exportProbe(path: string | undefined) {
  if (!path) return;
  const project = useProject.getState().project!;
  const t0 = performance.now();
  try {
    const layer = await renderTextLayer(project, project.settings.width, project.settings.height, project.settings.fps, () => {}, () => false);
    const t1 = performance.now();
    const out = await api.exportStart(project, {
      outputPath: path,
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      quality: "fast",
      textOverlay: layer?.list,
    });
    discardTextLayer(layer);
    log("autotest", `EXPORT ok ${JSON.stringify({ path: out.path, bytes: out.bytes, frames: layer?.frames, textMs: Math.round(t1 - t0), totalMs: Math.round(performance.now() - t0), duration: projectDuration(project) })}`);
  } catch (error) {
    log("autotest", `EXPORT failed ${String(error)}`);
  }
}

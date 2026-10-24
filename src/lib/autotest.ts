// Hidden self-test, enabled only by the XENOCUT_AUTOTEST=<media file> environment variable.
// Imports the file into a fresh project, plays it and logs what the <video> element reports,
// so playback can be verified on a headless machine (Xvfb) from the log file.
import { engine } from "../engine/playback";
import { openMediaAsProject } from "../project/actions";
import { usePlayback } from "../store/playback";
import { log, transport } from "./backend";
import { perfCounters } from "./perfHook";
import { useProject } from "../store/project";
import { useSettings } from "../store/settings";
import { useEditorUi } from "../store/editorUi";
import type { Grade } from "../project/grade";

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
  log("autotest", `start ${file}`);
  await sleep(800);
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
  await perfProbe();
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

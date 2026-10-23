// Hidden self-test, enabled only by the XENOCUT_AUTOTEST=<media file> environment variable.
// Imports the file into a fresh project, plays it and logs what the <video> element reports,
// so playback can be verified on a headless machine (Xvfb) from the log file.
import { engine } from "../engine/playback";
import { openMediaAsProject } from "../project/actions";
import { usePlayback } from "../store/playback";
import { log } from "./backend";

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
}

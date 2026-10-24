/**
 * XENOCUT_AUDIOCHECK=<media>|<export.mp4>: a normal run (no test mute) that opens the file, reads the preview
 * <video>'s audio state without playing it, then exports so the result's audio stream can be checked (ffprobe).
 * Logs "AUDIOCHECK …" lines. Importing autotest.ts for its helpers never mutes: only runAutotest does that.
 */
import { log } from "./backend";
import { openMediaAsProject } from "../project/actions";
import { engine, isSilent } from "../engine/playback";
import { useProject } from "../store/project";
import { exportProbe, waitForPreviewCopy } from "./autotest";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAudioCheck(spec: string) {
  const [file, out] = spec.split("|");
  await sleep(800);
  const ok = await openMediaAsProject(file, "Audio check");
  for (let i = 0; i < 50 && !document.querySelector("video.stage-media"); i++) await sleep(200);
  await sleep(1500);
  await waitForPreviewCopy();
  engine.seek(1);
  await sleep(1000);
  const v = document.querySelector("video.stage-media") as HTMLVideoElement | null;
  const project = useProject.getState().project;
  const media = project?.media.find((m) => m.path === file);
  const state = { opened: ok, silent: isSilent(), muted: v?.muted, volume: v?.volume, paused: v?.paused, hasAudio: media?.hasAudio };
  const pass = ok && !state.silent && state.muted === false && state.volume === 1;
  log("info", `AUDIOCHECK preview ${JSON.stringify(state)} → ${pass ? "PASS" : "FAIL"}`);
  if (out) await exportProbe(out);
  log("info", "AUDIOCHECK done");
}

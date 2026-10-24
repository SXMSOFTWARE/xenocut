// Project-level workflows shared by pages: create/open, import, add to timeline, autosave.
import { api, pickFiles, VIDEO_EXT, AUDIO_EXT, IMAGE_EXT } from "../lib/backend";
import { messageOf } from "../lib/format";
import { useProject } from "../store/project";
import { useAssets } from "../store/assets";
import { usePlayback } from "../store/playback";
import { useRouter } from "../store/router";
import { useSettings } from "../store/settings";
import { toast } from "../store/toast";
import { t } from "../i18n";
import type { Aspect, MediaItem, Project, Resolution } from "./types";
import {
  clipDuration,
  createProject,
  makeTrack,
  mediaFromProbe,
  nearestFreeStart,
  newClip,
  preferredTrackKind,
  sortTracks,
  trackAccepts,
} from "./ops";

export const MEDIA_FILTERS = [
  { name: "Media", extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
  { name: "Video", extensions: VIDEO_EXT },
  { name: "Audio", extensions: AUDIO_EXT },
  { name: "Image", extensions: IMAGE_EXT },
];

export const PROJECT_FILTERS = [{ name: "XenoCut", extensions: ["xcut"] }];

function enterEditor(project: Project, path: string) {
  useAssets.getState();
  usePlayback.setState({ time: 0, playing: false });
  useProject.getState().open(project, path);
  for (const media of project.media) requestAssets(media);
  useRouter.getState().go("editor");
}

export async function createAndOpen(name: string, aspect: Aspect, resolution: Resolution, fps: number): Promise<Project> {
  const project = createProject(name.trim() || t("home.untitled"), aspect, resolution, fps);
  const path = await api.projectNewPath(useSettings.getState().projectDir, project.name);
  await api.projectSave(path, project);
  enterEditor(project, path);
  return project;
}

export async function openProjectPath(path: string): Promise<boolean> {
  try {
    const project = await api.projectLoad(path);
    enterEditor(project, path);
    const missing = await api.pathsExist(project.media.map((m) => m.path));
    const lost = missing.filter((ok) => !ok).length;
    if (lost) toast(t("editor.missingMedia", { n: lost }), "error");
    return true;
  } catch (error) {
    toast(`${t("home.openFailed")}: ${messageOf(error)}`, "error");
    return false;
  }
}

export async function openProjectDialog() {
  const [path] = await pickFiles(PROJECT_FILTERS, false);
  if (path) await openProjectPath(path);
}

/** Probe files and add them to the bin. Returns the media items (existing ones reused). */
export async function importPaths(paths: string[]): Promise<MediaItem[]> {
  const state = useProject.getState();
  if (!state.project || paths.length === 0) return [];
  let outcome;
  try {
    outcome = await api.mediaProbe(paths);
  } catch (error) {
    toast(messageOf(error), "error");
    return [];
  }
  for (const err of outcome.errors.slice(0, 3)) toast(err, "error");
  const project = useProject.getState().project!;
  const result: MediaItem[] = [];
  const added: MediaItem[] = [];
  for (const info of outcome.items) {
    const existing = project.media.find((m) => m.path === info.path);
    if (existing) {
      result.push(existing);
      continue;
    }
    const media = mediaFromProbe(info);
    added.push(media);
    result.push(media);
  }
  if (added.length) {
    useProject.getState().commit((p) => ({ ...p, media: [...p.media, ...added] }));
    for (const media of added) requestAssets(media);
    toast(t("editor.imported", { n: added.length }), "success");
  }
  return result;
}

export async function importDialog() {
  const paths = await pickFiles(MEDIA_FILTERS, true);
  return importPaths(paths);
}

/** Lane id of the drop zone under the last track: dropping there creates a track. */
export const NEW_TRACK = "new";

/**
 * Put media on the timeline. With no track given, the first compatible track is used
 * (a new one is created when none exists). Overlaps are resolved to the nearest free spot.
 */
export function addToTimeline(media: MediaItem, at: number, trackId?: string | null): string | null {
  const store = useProject.getState();
  const project = store.project;
  if (!project) return null;
  let clipId: string | null = null;
  store.commit((p) => {
    let tracks = p.tracks;
    let track = trackId ? tracks.find((tr) => tr.id === trackId) : undefined;
    if (track && !trackAccepts(track.kind, media)) track = undefined;
    if (!track) {
      const kind = preferredTrackKind(media);
      track = trackId === NEW_TRACK ? undefined : tracks.find((tr) => tr.kind === kind);
      if (!track) {
        track = makeTrack(kind, tracks);
        tracks = sortTracks([...tracks, track]);
      }
    }
    const clip = newClip(media, track.id, 0);
    clip.start = nearestFreeStart({ ...p, tracks }, track.id, at, clipDuration(clip));
    clipId = clip.id;
    return { ...p, tracks, clips: [...p.clips, clip] };
  });
  if (clipId) useProject.getState().select([clipId]);
  return clipId;
}

// ---- autosave ----

let timer: number | undefined;

export function startAutosave(): () => void {
  const unsubscribe = useProject.subscribe((state, previous) => {
    if (state.project === previous.project && state.saveState === previous.saveState) return;
    if (state.saveState !== "dirty" || state.gestureBase) return;
    if (!useSettings.getState().autosave) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void useProject.getState().save(), 1200);
  });
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}

// ---- one-click results ----

const ASPECTS: [Aspect, number][] = [
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["1:1", 1],
  ["4:5", 4 / 5],
];

/** Project settings that best match a piece of media. */
export function settingsForMedia(info: { width: number; height: number; fps: number }): { aspect: Aspect; resolution: Resolution; fps: number } {
  const ratio = info.width > 0 && info.height > 0 ? info.width / info.height : 16 / 9;
  const aspect = ASPECTS.reduce((best, cur) => (Math.abs(Math.log(cur[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? cur : best))[0];
  const short = Math.min(info.width, info.height) || 1080;
  const resolution: Resolution = short >= 2000 ? "4K" : short >= 1400 ? "1440p" : short >= 1000 ? "1080p" : "720p";
  const fps = [24, 25, 30, 50, 60].reduce((best, cur) => (Math.abs(cur - info.fps) < Math.abs(best - info.fps) ? cur : best), 30);
  return { aspect, resolution, fps };
}

/** Create a new project around one file, put it on the timeline and open the editor. */
export async function openMediaAsProject(path: string, name: string): Promise<boolean> {
  try {
    const { items, errors } = await api.mediaProbe([path]);
    const info = items[0];
    if (!info) throw new Error(errors[0] ?? path);
    const s = settingsForMedia(info);
    await createAndOpen(name, s.aspect, s.resolution, s.fps);
    const [media] = await importPaths([path]);
    if (media) addToTimeline(media, 0);
    await useProject.getState().save();
    return true;
  } catch (error) {
    toast(`${t("home.openFailed")}: ${messageOf(error)}`, "error");
    return false;
  }
}

/** Thumbnails/waveforms, and the 540p preview copy in the background when that option is on. */
function requestAssets(media: MediaItem) {
  useAssets.getState().request(media);
  void useAssets.getState().requestProxy(media);
}

import type { ClipEffect } from "./effects";
import type { Grade } from "./grade";
import type { TextContent } from "./text";

// The .xcut project model. Mirrored by `src-tauri/src/project.rs` (serde, camelCase).

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Resolution = "720p" | "1080p" | "1440p" | "4K";
export type MediaKind = "video" | "audio" | "image";
export type TrackKind = "video" | "audio" | "music" | "text";

export interface ProjectSettings {
  aspect: Aspect;
  resolution: Resolution;
  width: number;
  height: number;
  fps: number;
  /** Colour grade id from `project/grade.ts`; absent = none. */
  grade?: Grade;
}

export interface MediaItem {
  id: string;
  path: string;
  name: string;
  kind: MediaKind;
  /** Seconds. Images report 0. */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  /** Purpose beyond the kind: the track generated captions ("subtitles") or song lyrics live on. */
  role?: "subtitles" | "lyrics";
}

export interface Clip {
  id: string;
  trackId: string;
  mediaId: string;
  /** Timeline position, seconds. */
  start: number;
  /** Source in point, seconds. */
  in: number;
  /** Source out point, seconds. */
  out: number;
  speed: number;
  volume: number;
  opacity: number;
  fadeIn: number;
  fadeOut: number;
  /** Text clips only (mediaId is ""): content, style and animation. */
  text?: TextContent;
  /** Video effects (see project/effects.ts). */
  effects?: ClipEffect[];
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  created: string;
  modified: string;
  settings: ProjectSettings;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
}

export interface ProbeInfo {
  path: string;
  name: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
}

export interface MediaAssets {
  thumb: string | null;
  strip: string | null;
  stripCount: number;
  stripFrameW: number;
  stripFrameH: number;
  wave: string | null;
}

export type ToolId = "video" | "mic" | "music" | "effects" | "waveform" | "color" | "text";

export type Tint = "blue" | "gold" | "purple" | "red";

export type Aspect = "9:16" | "16:9" | "1:1" | "4:5";

export type Resolution = "720p" | "1080p" | "1440p" | "4K";

export type Grade = "None" | "Warm" | "Cool" | "Mono" | "Soft";

export interface Clip {
  id: string;
  start: number;
  end: number;
  tint: Tint;
  thumbnails: string[];
}

export interface AudioStepState {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  message: string;
}

export interface AudioProgress {
  step: number;
  progress: number;
  message: string;
  done: boolean;
}

import type { Clip } from "../types";

export const DEMO_DURATION = 60;

export const DEMO_PROMPT = `Extreme close-up. An eye fills the frame, lashes sharp, the iris holding a warm point of light. Crimson feathers crowd the temple and cheek while gold leaf rests on the lid, catching a low orange key.

The camera holds, then drifts — a silent passage through texture and color. No cut, no dialogue. Let the makeup and the feathers carry the shot.`;

export const HERO = "/demo/hero.jpg";
export const FRAME_IRIS = "/demo/frame-iris.jpg";
export const STACK_FEATHER = "/demo/stack-feather.jpg";
export const STACK_GOLD = "/demo/stack-gold.jpg";

export const DEMO_FRAMES = [HERO, FRAME_IRIS, STACK_FEATHER, STACK_GOLD];

export function demoClips(): Clip[] {
  return [
    {
      id: "clip-blue",
      start: 0,
      end: 12,
      tint: "blue",
      thumbnails: [HERO, FRAME_IRIS, STACK_FEATHER],
    },
    {
      id: "clip-gold",
      start: 12,
      end: 22,
      tint: "gold",
      thumbnails: [STACK_GOLD, HERO],
    },
    {
      id: "clip-purple",
      start: 22,
      end: 42,
      tint: "purple",
      thumbnails: [FRAME_IRIS, STACK_FEATHER, STACK_GOLD],
    },
    {
      id: "clip-red",
      start: 42,
      end: 60,
      tint: "red",
      thumbnails: [HERO, STACK_GOLD, FRAME_IRIS],
    },
  ];
}

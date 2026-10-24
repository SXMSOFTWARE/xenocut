// Dev-only: renders transitions for scripted parity checks against FFmpeg xfade.
import { TransitionRenderer } from "../transitions/gl";
import { BUILTINS, BUILTIN } from "../transitions";

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

const w = window as unknown as Record<string, unknown>;
const canvas = document.getElementById("c") as HTMLCanvasElement;
const r = new TransitionRenderer(canvas, true);
let imgs: [HTMLImageElement, HTMLImageElement] | null = null;
w.tlab = {
  ids: BUILTINS.map((d) => d.id),
  async setup(a: string, b: string, width: number, height: number) {
    imgs = [await load(a), await load(b)];
    canvas.width = width;
    canvas.height = height;
  },
  check(glsl: string, builtin: boolean) { return r.check(glsl, builtin); },
  /** RGBA bytes (top row first) as base64. */
  render(id: string, progress: number, glsl?: string) {
    const def = BUILTIN.get(id);
    const ok = r.render({ glsl: glsl ?? def!.glsl, builtin: !glsl, from: imgs![0], to: imgs![1], progress });
    if (!ok) return "ERR:" + r.error;
    const gl = canvas.getContext("webgl")!;
    const W = canvas.width, H = canvas.height;
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const flipped = new Uint8Array(px.length);
    for (let y = 0; y < H; y++) flipped.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    let s = "";
    for (let i = 0; i < flipped.length; i += 0x8000) s += String.fromCharCode(...flipped.subarray(i, i + 0x8000));
    return btoa(s);
  },
};
w.tlabReady = true;

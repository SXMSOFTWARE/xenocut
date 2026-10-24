// WebGL renderer for transitions in gl-transitions form. One instance draws the preview window,
// the browser demos and the export frames. Sources are letterboxed into the stage like the
// export (black around them), so every shader sees the same picture in all three places.
import { XFADE_PRELUDE } from "./builtins";
import { parseUniforms, type UniformSpec } from "./index";

export type Source = TexImageSource;

const VS = `attribute vec2 p; varying vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `precision highp float;
varying vec2 vUv;
uniform sampler2D xcFrom; uniform sampler2D xcTo;
uniform vec4 xcFromRect; uniform vec4 xcToRect;
uniform float progress; uniform float ratio;
vec4 xcSample(sampler2D s, vec4 r, vec2 uv) {
  vec2 q = (uv - r.xy) / r.zw;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return texture2D(s, vec2(q.x, 1.0 - q.y));
}
vec4 getFromColor(vec2 uv) { return xcSample(xcFrom, xcFromRect, uv); }
vec4 getToColor(vec2 uv) { return xcSample(xcTo, xcToRect, uv); }
`;

/** Full fragment shader for a transition body. */
export function shaderSource(glsl: string, builtin: boolean): string {
  return `${HEAD}${builtin ? XFADE_PRELUDE : ""}\n#line 1\n${glsl}\nvoid main() { gl_FragColor = transition(vUv); }\n`;
}

interface Program {
  prog: WebGLProgram;
  specs: UniformSpec[];
  loc: Map<string, WebGLUniformLocation | null>;
}

export interface RenderJob {
  glsl: string;
  builtin: boolean;
  params?: Record<string, number | number[] | boolean>;
  from: Source;
  to: Source;
  /** Source sizes (for letterboxing); omit when the source already has the stage size. */
  fromSize?: [number, number];
  toSize?: [number, number];
  progress: number;
}

/** Contain-fit rect of a w×h source in the W×H stage, in uv units (bottom-left origin). */
export function fitRect(w: number, h: number, W: number, H: number): [number, number, number, number] {
  if (!(w > 0 && h > 0)) return [0, 0, 1, 1];
  const s = Math.min(W / w, H / h);
  const rw = (w * s) / W, rh = (h * s) / H;
  return [(1 - rw) / 2, (1 - rh) / 2, rw, rh];
}

export class TransitionRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private programs = new Map<string, Program | null>();
  private tex: [WebGLTexture, WebGLTexture] | null = null;
  /** Last compile error (for logs / the pack UI). */
  error = "";

  constructor(canvas?: HTMLCanvasElement, private preserve = false) {
    this.canvas = canvas ?? document.createElement("canvas");
  }

  private ensure(): WebGLRenderingContext | null {
    if (this.gl) return this.gl.isContextLost() ? null : this.gl;
    const gl = this.canvas.getContext("webgl", { premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: this.preserve, antialias: false });
    if (!gl) return null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const mk = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return t;
    };
    this.tex = [mk(), mk()];
    this.gl = gl;
    return gl;
  }

  /** Compiles (cached) and returns null with `error` set when the shader is broken. */
  private program(glsl: string, builtin: boolean): Program | null {
    const key = (builtin ? "b:" : "p:") + glsl;
    if (this.programs.has(key)) return this.programs.get(key)!;
    const gl = this.gl!;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        this.error = gl.getShaderInfoLog(s) ?? "compile error";
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, shaderSource(glsl, builtin));
    let out: Program | null = null;
    if (vs && fs) {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "p");
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const specs = parseUniforms(glsl);
        const loc = new Map<string, WebGLUniformLocation | null>();
        for (const n of ["xcFrom", "xcTo", "xcFromRect", "xcToRect", "progress", "ratio", "resolution", ...specs.map((s) => s.name)]) loc.set(n, gl.getUniformLocation(prog, n));
        out = { prog, specs, loc };
      } else this.error = gl.getProgramInfoLog(prog) ?? "link error";
    }
    this.programs.set(key, out);
    return out;
  }

  /** Checks that a shader compiles here. Returns the error text or "". */
  check(glsl: string, builtin = false): string {
    if (!this.ensure()) return "WebGL unavailable";
    this.error = "";
    return this.program(glsl, builtin) ? "" : this.error || "shader error";
  }

  /** Draws one frame at the canvas size. Returns false when it couldn't (no WebGL, bad shader). */
  render(job: RenderJob): boolean {
    const gl = this.ensure();
    if (!gl) return false;
    const p = this.program(job.glsl, job.builtin);
    if (!p) return false;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(p.prog);
    const [ta, tb] = this.tex!;
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ta);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, job.from);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tb);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, job.to);
    } catch {
      return false; // a source without a decoded frame yet
    }
    const u = (n: string) => p.loc.get(n) ?? null;
    gl.uniform1i(u("xcFrom"), 0);
    gl.uniform1i(u("xcTo"), 1);
    gl.uniform4fv(u("xcFromRect"), job.fromSize ? fitRect(job.fromSize[0], job.fromSize[1], W, H) : [0, 0, 1, 1]);
    gl.uniform4fv(u("xcToRect"), job.toSize ? fitRect(job.toSize[0], job.toSize[1], W, H) : [0, 0, 1, 1]);
    gl.uniform1f(u("progress"), Math.min(1, Math.max(0, job.progress)));
    gl.uniform1f(u("ratio"), W / H);
    gl.uniform2f(u("resolution"), W, H);
    for (const s of p.specs) {
      const raw = job.params?.[s.name];
      const v = raw === undefined ? s.value : typeof raw === "boolean" ? [raw ? 1 : 0] : Array.isArray(raw) ? raw : [raw];
      const l = u(s.name);
      if (!l) continue;
      switch (s.type) {
        case "float": gl.uniform1f(l, v[0] ?? 0); break;
        case "int": case "bool": gl.uniform1i(l, Math.round(v[0] ?? 0)); break;
        case "ivec2": gl.uniform2i(l, Math.round(v[0] ?? 0), Math.round(v[1] ?? 0)); break;
        case "vec2": gl.uniform2f(l, v[0] ?? 0, v[1] ?? 0); break;
        case "vec3": gl.uniform3f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0); break;
        case "vec4": gl.uniform4f(l, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0); break;
      }
    }
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  dispose() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    this.programs.clear();
  }
}

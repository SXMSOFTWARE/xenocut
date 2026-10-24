// Preview of a clip's colour LUT: a WebGL2 canvas next to the media element draws each frame
// through a 3D texture (trilinear; the export uses FFmpeg's tetrahedral lut3d, visually the
// same). The media element stays in place (transparent) so decoding, sync and audio are
// untouched; filters and opacity move over to the canvas.
import { loadCube, type Cube } from "../lib/plugins";
import { log } from "../lib/backend";
import type { ClipLut } from "../project/types";

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler2D img; uniform sampler3D lut; uniform float amount, size; uniform vec3 dmin, dmax;
in vec2 uv; out vec4 o;
void main() {
  vec4 c = texture(img, uv);
  vec3 x = clamp((c.rgb - dmin) / (dmax - dmin), 0.0, 1.0);
  vec3 m = texture(lut, x * (size - 1.0) / size + 0.5 / size).rgb;
  o = vec4(mix(c.rgb, m, amount), c.a);
}`;

type Source = HTMLVideoElement | HTMLImageElement;

export class LutView {
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private img: WebGLTexture | null = null;
  private lut: WebGLTexture | null = null;
  private cube: Cube | null = null;
  private cubePath = "";
  private loading = "";
  private amount = 1;
  private source: Source | null = null;
  private raf = 0;
  private broken = false;
  private lastImageKey = "";

  constructor(
    private canvas: HTMLCanvasElement,
    /** Called when a LUT finished loading, so a paused frame gets redrawn. */
    private onReady: () => void,
  ) {}

  /** Show `source` through `lut` (or stop). Returns true while the canvas is drawing it. */
  update(source: Source | null, lut: ClipLut | undefined, filter: string, opacity: string): boolean {
    const want = !!source && !!lut && lut.amount > 0.001 && !this.broken;
    if (!want) {
      this.stop();
      return false;
    }
    this.amount = Math.min(1, lut!.amount);
    if (this.cubePath !== lut!.path) {
      if (this.loading !== lut!.path) {
        this.loading = lut!.path;
        void loadCube(lut!.path).then((c) => {
          if (this.loading !== lut!.path) return;
          this.loading = "";
          this.cube = c;
          this.cubePath = lut!.path;
          if (c && this.ensureGl()) this.uploadCube(c);
          this.onReady();
        });
      }
      if (!this.cube || this.cubePath !== lut!.path) {
        this.stop();
        return false;
      }
    }
    if (!this.cube || !this.ensureGl()) {
      this.stop();
      return false;
    }
    this.source = source;
    this.canvas.style.filter = filter;
    this.canvas.style.opacity = opacity;
    this.canvas.style.visibility = "visible";
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
    return true;
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.source = null;
    this.lastImageKey = "";
    this.canvas.style.visibility = "hidden";
  }

  dispose() {
    this.stop();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }

  private ensureGl(): boolean {
    if (this.gl) return true;
    if (this.broken) return false;
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: false });
    if (!gl) return this.fail("WebGL2 unavailable");
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.img = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.img);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.lut = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, this.lut);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
      gl.uniform1i(gl.getUniformLocation(prog, "img"), 0);
      gl.uniform1i(gl.getUniformLocation(prog, "lut"), 1);
      this.gl = gl;
      this.prog = prog;
      if (this.cube) this.uploadCube(this.cube);
      return true;
    } catch (e) {
      return this.fail(String(e));
    }
  }

  private fail(why: string): false {
    this.broken = true;
    log("warn", `lut preview off: ${why}`);
    return false;
  }

  private uploadCube(c: Cube) {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lut);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, c.size, c.size, c.size, 0, gl.RGB, gl.FLOAT, new Float32Array(c.data));
    gl.uniform1f(gl.getUniformLocation(this.prog!, "size"), c.size);
    gl.uniform3fv(gl.getUniformLocation(this.prog!, "dmin"), c.domainMin);
    gl.uniform3fv(gl.getUniformLocation(this.prog!, "dmax"), c.domainMax);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const gl = this.gl;
    const src = this.source;
    if (!gl || !src) return;
    const video = src instanceof HTMLVideoElement ? src : null;
    const w = video ? video.videoWidth : (src as HTMLImageElement).naturalWidth;
    const h = video ? video.videoHeight : (src as HTMLImageElement).naturalHeight;
    if (!w || !h || (video && video.readyState < 2)) return;
    // Stills only redraw when something changes.
    const key = `${src.currentSrc}|${this.amount}|${this.cubePath}|${w}x${h}`;
    if (!video && key === this.lastImageKey) return;
    this.lastImageKey = key;
    const scale = Math.min(1, 1920 / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    try {
      gl.viewport(0, 0, cw, ch);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.img);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform1f(gl.getUniformLocation(this.prog!, "amount"), this.amount);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (e) {
      // A cross-origin (tainted) source or a lost context: fall back to the plain element.
      this.fail(String(e));
      this.stop();
    }
  };
}

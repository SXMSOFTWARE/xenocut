// GLSL ports of FFmpeg's xfade transitions (libavfilter/vf_xfade.c), in gl-transitions form.
// The export renders built-ins with xfade itself; these drive the preview and the browser demos,
// so they follow the C code closely: pixel coordinates from the top-left, integer truncation
// where the C code converts to int, and `cmix(a, b, m) = a * m + b * (1 - m)` like its mix().
// xfade's progress runs 1 → 0 over the transition, so `pr = 1.0 - progress`.

/** Shared helpers prepended to every built-in (needs the `resolution` uniform). */
export const XFADE_PRELUDE = `
uniform vec2 resolution;
float trunc_(float v) { return v < 0.0 ? ceil(v) : floor(v); }
vec2 px(vec2 uv) { return vec2(floor(uv.x * resolution.x), floor((1.0 - uv.y) * resolution.y)); }
vec4 A(vec2 p) { return getFromColor(vec2((p.x + 0.5) / resolution.x, 1.0 - (p.y + 0.5) / resolution.y)); }
vec4 B(vec2 p) { return getToColor(vec2((p.x + 0.5) / resolution.x, 1.0 - (p.y + 0.5) / resolution.y)); }
vec4 cmix(vec4 a, vec4 b, float m) { return a * m + b * (1.0 - m); }
float frand(vec2 p) { float r = sin(p.x * 12.9898 + p.y * 78.233) * 43758.545; return r - floor(r); }
float luma(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }
#define HEAD vec2 q = px(uv); float x = q.x; float y = q.y; float W = resolution.x; float H = resolution.y; float pr = 1.0 - progress;
`;

const T = (body: string) => `vec4 transition(vec2 uv) { HEAD ${body} }`;

const fadeTo = (bg: string) =>
  T(`vec4 c = ${bg}; return cmix(cmix(A(q), c, smoothstep(0.8, 1.0, pr)), cmix(c, B(q), smoothstep(0.2, 1.0, pr)), pr);`);

const slideH = (sign: string) =>
  T(`float z = trunc_(${sign}pr * W); float zx = z + x; float zz = mod(zx, W);
     return (zx >= 0.0 && zx < W) ? B(vec2(zz, y)) : A(vec2(zz, y));`);
const slideV = (sign: string) =>
  T(`float z = trunc_(${sign}pr * H); float zy = z + y; float zz = mod(zy, H);
     return (zy >= 0.0 && zy < H) ? B(vec2(x, zz)) : A(vec2(x, zz));`);
const coverH = (sign: string) =>
  T(`float z = trunc_(${sign}pr * W); float zx = z + x; float zz = mod(zx, W);
     return (zx >= 0.0 && zx < W) ? B(vec2(zz, y)) : A(q);`);
const coverV = (sign: string) =>
  T(`float z = trunc_(${sign}pr * H); float zy = z + y; float zz = mod(zy, H);
     return (zy >= 0.0 && zy < H) ? B(vec2(x, zz)) : A(q);`);
const revealH = (sign: string) =>
  T(`float z = trunc_(${sign}pr * W); float zx = z + x; float zz = mod(zx, W);
     return (zx >= 0.0 && zx < W) ? B(q) : A(vec2(zz, y));`);
const revealV = (sign: string) =>
  T(`float z = trunc_(${sign}pr * H); float zy = z + y; float zz = mod(zy, H);
     return (zy >= 0.0 && zy < H) ? B(q) : A(vec2(x, zz));`);
const smooth = (expr: string) => T(`float s = ${expr}; return cmix(B(q), A(q), smoothstep(0.0, 1.0, s));`);
const slice = (coord: string) =>
  T(`float c = ${coord}; float s = smoothstep(-0.5, 0.0, c - pr * 1.5); float ss = s <= fract(10.0 * c) ? 0.0 : 1.0;
     return cmix(B(q), A(q), ss);`);

/** id → GLSL body (without prelude). Ids are the xfade names (see transitions.rs XFADE). */
export const XFADE_GLSL: Record<string, string> = {
  fade: T(`return cmix(A(q), B(q), pr);`),
  fadeblack: fadeTo("vec4(0.0, 0.0, 0.0, 1.0)"),
  fadewhite: fadeTo("vec4(1.0)"),
  fadegrays: T(`vec4 a = A(q); vec4 b = B(q);
    vec4 ga = vec4(vec3(luma(a)), a.a); vec4 gb = vec4(vec3(luma(b)), b.a);
    return cmix(cmix(a, ga, smoothstep(0.8, 1.0, pr)), cmix(gb, b, smoothstep(0.2, 1.0, pr)), pr);`),
  dissolve: T(`float s = frand(q) * 2.0 + pr * 2.0 - 1.5; return s >= 0.5 ? A(q) : B(q);`),
  pixelize: T(`float d = min(pr, 1.0 - pr); float dist = ceil(d * 50.0) / 50.0; float sq = 2.0 * dist * min(W, H) / 20.0;
    vec2 s = dist > 0.0 ? vec2(trunc_(min((floor(x / sq) + 0.5) * sq, W - 1.0)), trunc_(min((floor(y / sq) + 0.5) * sq, H - 1.0))) : q;
    return cmix(A(s), B(s), pr);`),
  wipeleft: T(`float z = trunc_(W * pr); return x > z ? B(q) : A(q);`),
  wiperight: T(`float z = trunc_(W * (1.0 - pr)); return x > z ? A(q) : B(q);`),
  wipeup: T(`float z = trunc_(H * pr); return y > z ? B(q) : A(q);`),
  wipedown: T(`float z = trunc_(H * (1.0 - pr)); return y > z ? A(q) : B(q);`),
  wipetl: T(`float zw = trunc_(W * pr); float zh = trunc_(H * pr); return (y <= zh && x <= zw) ? A(q) : B(q);`),
  wipetr: T(`float zw = trunc_(W * (1.0 - pr)); float zh = trunc_(H * pr); return (y <= zh && x > zw) ? A(q) : B(q);`),
  wipebl: T(`float zw = trunc_(W * pr); float zh = trunc_(H * (1.0 - pr)); return (y > zh && x <= zw) ? A(q) : B(q);`),
  wipebr: T(`float zw = trunc_(W * (1.0 - pr)); float zh = trunc_(H * (1.0 - pr)); return (y > zh && x > zw) ? A(q) : B(q);`),
  slideleft: slideH("-"),
  slideright: slideH(""),
  slideup: slideV("-"),
  slidedown: slideV(""),
  coverleft: coverH("-"),
  coverright: coverH(""),
  coverup: coverV("-"),
  coverdown: coverV(""),
  revealleft: revealH("-"),
  revealright: revealH(""),
  revealup: revealV("-"),
  revealdown: revealV(""),
  smoothleft: smooth(`1.0 + x / W - pr * 2.0`),
  smoothright: smooth(`1.0 + (W - 1.0 - x) / W - pr * 2.0`),
  smoothup: smooth(`1.0 + y / H - pr * 2.0`),
  smoothdown: smooth(`1.0 + (H - 1.0 - y) / H - pr * 2.0`),
  circleopen: T(`float hw = floor(W / 2.0); float hh = floor(H / 2.0); float z = length(vec2(hw, hh));
    float s = length(vec2(x - hw, y - hh)) / z + (pr - 0.5) * 3.0; return cmix(A(q), B(q), smoothstep(0.0, 1.0, s));`),
  circleclose: T(`float hw = floor(W / 2.0); float hh = floor(H / 2.0); float z = length(vec2(hw, hh));
    float s = length(vec2(x - hw, y - hh)) / z + (1.0 - pr - 0.5) * 3.0; return cmix(B(q), A(q), smoothstep(0.0, 1.0, s));`),
  circlecrop: T(`float hw = floor(W / 2.0); float hh = floor(H / 2.0);
    float z = pow(2.0 * abs(pr - 0.5), 3.0) * length(vec2(hw, hh)); float dist = length(vec2(x - hw, y - hh));
    vec4 val = pr < 0.5 ? B(q) : A(q); return z < dist ? vec4(0.0, 0.0, 0.0, 1.0) : val;`),
  rectcrop: T(`float zh = trunc_(abs(pr - 0.5) * H); float zw = trunc_(abs(pr - 0.5) * W);
    bool inside = abs(x - floor(W / 2.0)) < zw && abs(y - floor(H / 2.0)) < zh;
    vec4 val = pr < 0.5 ? B(q) : A(q); return inside ? val : vec4(0.0, 0.0, 0.0, 1.0);`),
  vertopen: smooth(`2.0 - abs((x - W / 2.0) / (W / 2.0)) - pr * 2.0`),
  vertclose: smooth(`1.0 + abs((x - W / 2.0) / (W / 2.0)) - pr * 2.0`),
  horzopen: smooth(`2.0 - abs((y - H / 2.0) / (H / 2.0)) - pr * 2.0`),
  horzclose: smooth(`1.0 + abs((y - H / 2.0) / (H / 2.0)) - pr * 2.0`),
  radial: smooth(`atan(x - floor(W / 2.0), y - floor(H / 2.0)) - (pr - 0.5) * (3.14159265 * 2.5)`),
  diagtl: smooth(`1.0 + x / W * y / H - pr * 2.0`),
  diagtr: smooth(`1.0 + (W - 1.0 - x) / W * y / H - pr * 2.0`),
  diagbl: smooth(`1.0 + x / W * (H - 1.0 - y) / H - pr * 2.0`),
  diagbr: smooth(`1.0 + (W - 1.0 - x) / W * (H - 1.0 - y) / H - pr * 2.0`),
  hlslice: slice(`x / W`),
  hrslice: slice(`(W - 1.0 - x) / W`),
  vuslice: slice(`y / H`),
  vdslice: slice(`(H - 1.0 - y) / H`),
  squeezeh: T(`float z = pr > 0.0 ? 0.5 + (y / H - 0.5) / pr : -1.0;
    if (z < 0.0 || z > 1.0) return B(q); return A(vec2(x, floor(z * (H - 1.0) + 0.5)));`),
  squeezev: T(`float z = pr > 0.0 ? 0.5 + (x / W - 0.5) / pr : -1.0;
    if (z < 0.0 || z > 1.0) return B(q); return A(vec2(floor(z * (W - 1.0) + 0.5), y));`),
  zoomin: T(`float zf = smoothstep(0.5, 1.0, pr); float u = 0.5 + (x / W - 0.5) * zf; float v = 0.5 + (y / H - 0.5) * zf;
    vec4 zv = A(vec2(ceil(u * (W - 1.0)), ceil(v * (H - 1.0)))); return cmix(zv, B(q), smoothstep(0.0, 0.5, pr));`),
};

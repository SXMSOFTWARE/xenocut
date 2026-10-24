// Which UI to show. The mobile editor is picked by platform, not by window width: a narrow
// desktop window keeps the desktop layout. Android (the Tauri mobile build) and touch-first mobile
// browsers get the mobile UI. `?ui=mobile|desktop` (or localStorage "xc-ui") overrides it for
// design checks.
const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

function forced(): "mobile" | "desktop" | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("ui");
    if (q === "mobile" || q === "desktop") {
      localStorage.setItem("xc-ui", q);
      return q;
    }
    const s = localStorage.getItem("xc-ui");
    return s === "mobile" || s === "desktop" ? s : null;
  } catch {
    return null;
  }
}

const touch = typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

export const isMobileUi: boolean = forced() === "mobile" || (forced() !== "desktop" && mobileUa && (touch || /Android/i.test(ua)));

// ---- Device metrics (Android) ----
// The Android shell is edge-to-edge and its WebView reports 0 for env(safe-area-inset-*), so the
// native side (MainActivity.kt) exposes the real system-bar insets and the font scale. They land in
// CSS as --sa-top/right/bottom/left (default: env()) and --fs-k (text scale for the mobile UI).
type Native = { insets(): string; fontScale(): number };
const FONT_SCALE_MIN = 0.9;
const FONT_SCALE_MAX = 1.2; // past this the fixed-height controls stop fitting; layout is checked at 1.2

export function applyFontScale(scale: number) {
  const k = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale || 1));
  document.documentElement.style.setProperty("--fs-k", String(Math.round(k * 100) / 100));
}

export function initDeviceMetrics() {
  const root = document.documentElement.style;
  const q = new URLSearchParams(window.location.search);
  // design checks: ?fontscale=1.3&insets=32,0,24,0
  if (q.get("fontscale")) applyFontScale(Number(q.get("fontscale")));
  const qi = q.get("insets")?.split(",").map(Number);
  if (qi && qi.length === 4) ["top", "right", "bottom", "left"].forEach((k, i) => root.setProperty(`--sa-${k}`, `${qi[i]}px`));
  const native = (window as unknown as { XenoNative?: Native }).XenoNative;
  if (!native) return;
  const read = () => {
    try {
      const v = JSON.parse(native.insets()) as Record<string, number>;
      for (const k of ["top", "right", "bottom", "left"]) root.setProperty(`--sa-${k}`, `${v[k] ?? 0}px`);
      root.setProperty("--kb", `${v.ime ?? 0}px`);
      applyFontScale(native.fontScale());
    } catch {
      /* bridge not ready */
    }
  };
  read();
  window.addEventListener("xc-insets", read);
  window.addEventListener("resize", read);
}

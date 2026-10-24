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

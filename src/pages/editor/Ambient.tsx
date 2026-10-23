import { useEffect, useState } from "react";
import { usePosterThumb } from "./SidePanel";

/**
 * The reference's full-bleed picture behind the UI, done cheaply: the poster thumbnail is drawn
 * into a tiny canvas once and stretched, so bilinear upscaling does the "blur" — no CSS blur,
 * no backdrop-filter, nothing re-rendered per frame.
 */
export function Ambient() {
  const src = usePosterThumb();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return setUrl(null);
    let alive = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!alive) return;
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 14;
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        setUrl(c.toDataURL("image/png"));
      } catch {
        setUrl(null); // tainted canvas (asset:// fallback): keep the plain warm gradient
      }
    };
    img.onerror = () => alive && setUrl(null);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);

  return (
    <div className="ambient" aria-hidden="true">
      {url && <div className="ambient-img" style={{ backgroundImage: `url("${url}")` }} />}
      <div className="ambient-shade" />
    </div>
  );
}

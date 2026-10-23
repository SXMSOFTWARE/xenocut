import { useEffect, useRef, useState } from "react";
import { LayoutGrid, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { HexagonIcon } from "./icons";
import { Popover, QuickSettings, type SettingsMenu } from "./QuickSettings";
import { useMedia } from "../context/MediaContext";
import { useEditorStore } from "../store/editorStore";

export function TransportBar() {
  const playing = useEditorStore((state) => state.playing);
  const guides = useEditorStore((state) => state.guides);
  const snap = useEditorStore((state) => state.snap);
  const toggleGuides = useEditorStore((state) => state.toggleGuides);
  const setSnap = useEditorStore((state) => state.setSnap);
  const { togglePlay, skip } = useMedia();
  const [menu, setMenu] = useState<SettingsMenu>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".menu") || target?.closest(".setting-chip") || target?.closest("[data-settings]")) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  return (
    <div className="transport">
      <div className="transport-group">
        <button type="button" className="transport-btn" aria-label="Skip to start" onClick={() => skip("start")}>
          <SkipBack size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="transport-btn" aria-label="Back five seconds" onClick={() => skip(-5)}>
          <RotateCcw size={15} strokeWidth={1.75} />
        </button>
        <button type="button" className="transport-btn" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? (
            <Pause size={14} fill="currentColor" strokeWidth={1.75} />
          ) : (
            <Play size={14} fill="currentColor" strokeWidth={1.75} />
          )}
        </button>
        <button type="button" className="transport-btn" aria-label="Skip to end" onClick={() => skip("end")}>
          <SkipForward size={15} strokeWidth={1.75} />
        </button>
      </div>
      <div className="chip-scroll">
        <QuickSettings menu={menu} onMenu={setMenu} />
      </div>
      <div className="transport-group right">
        <button
          type="button"
          className="transport-btn"
          aria-label="Thirds guide"
          aria-pressed={guides}
          onClick={toggleGuides}
        >
          <LayoutGrid size={15} strokeWidth={1.75} />
        </button>
        <div>
          <button
            ref={settingsRef}
            type="button"
            className="transport-btn"
            data-settings="true"
            aria-label="Settings"
            aria-expanded={menu === "settings"}
            onClick={() => setMenu(menu === "settings" ? null : "settings")}
          >
            <HexagonIcon />
          </button>
          <Popover open={menu === "settings"} anchorRef={settingsRef} align="right">
            <label>
              Snap playhead
              <input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} />
            </label>
          </Popover>
        </div>
      </div>
    </div>
  );
}
